//! Windows render-endpoint loopback for consensual practice sessions.
//! The worker owns its COM apartment and never opens a microphone stream.
use serde::Serialize;
use std::sync::Mutex;
use tauri::{State, WebviewWindow, ipc::Channel};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemOutput {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureInfo {
    pub output_id: String,
    pub output_name: String,
    pub sample_rate: u32,
}

#[derive(Default)]
pub struct SystemLoopbackState {
    #[cfg(target_os = "windows")]
    session: Mutex<Option<win::Worker>>,
}

#[tauri::command]
pub fn list_system_outputs(window: WebviewWindow) -> Result<Vec<SystemOutput>, String> {
    if window.label() != "main" {
        return Err("Audio setup is only available in the main window.".into());
    }
    #[cfg(target_os = "windows")]
    {
        win::outputs()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Automatic system listening is currently Windows only.".into())
    }
}

#[tauri::command]
pub fn start_system_output_capture(
    window: WebviewWindow,
    state: State<'_, SystemLoopbackState>,
    output_id: String,
    on_audio: Channel<Vec<i16>>,
    on_error: Channel<String>,
) -> Result<CaptureInfo, String> {
    if window.label() != "main" {
        return Err("Audio capture is only available in the main window.".into());
    }
    #[cfg(target_os = "windows")]
    {
        let mut session = state
            .session
            .lock()
            .map_err(|_| "Audio capture is unavailable.")?;
        if session.is_some() {
            return Err("Stop listening before starting another capture.".into());
        }
        let output = win::outputs()?
            .into_iter()
            .find(|item| item.id == output_id)
            .ok_or("The selected Windows output is no longer available.")?;
        let worker = win::Worker::start(&output_id, on_audio, on_error)?;
        *session = Some(worker);
        Ok(CaptureInfo {
            output_id,
            output_name: output.name,
            sample_rate: 24_000,
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (state, output_id, on_audio, on_error);
        Err("Automatic system listening is currently Windows only.".into())
    }
}

#[tauri::command]
pub fn stop_system_output_capture(
    window: WebviewWindow,
    state: State<'_, SystemLoopbackState>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Audio capture is only available in the main window.".into());
    }
    stop_all(&state);
    Ok(())
}

pub fn stop_all(state: &SystemLoopbackState) {
    #[cfg(target_os = "windows")]
    if let Ok(mut session) = state.session.lock() {
        session.take();
    }
    #[cfg(not(target_os = "windows"))]
    let _ = state;
}

#[cfg(target_os = "windows")]
mod win {
    use super::SystemOutput;
    use cpal::traits::{DeviceTrait, HostTrait};
    use std::{
        sync::mpsc,
        thread::{self, JoinHandle},
        time::Duration,
    };
    use tauri::ipc::Channel;
    use windows::{
        Win32::{
            Media::{
                Audio::*,
                KernelStreaming::{KSDATAFORMAT_SUBTYPE_PCM, WAVE_FORMAT_EXTENSIBLE},
                Multimedia::KSDATAFORMAT_SUBTYPE_IEEE_FLOAT,
            },
            System::Com::*,
        },
        core::Interface,
    };

    pub fn outputs() -> Result<Vec<SystemOutput>, String> {
        let host = cpal::default_host();
        let default = host
            .default_output_device()
            .and_then(|item| item.id().ok())
            .map(|id| id.to_string());
        let devices = host
            .output_devices()
            .map_err(|_| "Windows outputs could not be listed.")?;
        let mut result = Vec::new();
        for device in devices {
            let Ok(id) = device.id() else { continue };
            let Ok(name) = device.description() else {
                continue;
            };
            let id = id.to_string();
            result.push(SystemOutput {
                is_default: default.as_deref() == Some(&id),
                id,
                name: name.name().to_owned(),
            });
        }
        Ok(result)
    }

    pub struct Worker {
        stop: mpsc::Sender<()>,
        thread: Option<JoinHandle<()>>,
    }

    impl Worker {
        pub fn start(
            id: &str,
            on_audio: Channel<Vec<i16>>,
            on_error: Channel<String>,
        ) -> Result<Self, String> {
            let native_id = id
                .split_once(':')
                .map(|(_, native)| native.to_owned())
                .ok_or("Invalid Windows output identifier.")?;
            let (stop, stop_rx) = mpsc::channel();
            let (ready, ready_rx) = mpsc::sync_channel(1);
            let thread = thread::spawn(move || {
                let mut capture = match unsafe { Capture::open(&native_id) } {
                    Ok(capture) => capture,
                    Err(error) => {
                        let _ = ready.send(Err(error));
                        return;
                    }
                };
                let mut encoder =
                    Encoder::new(capture.format.rate, capture.format.channels as usize);
                if ready.send(Ok(())).is_err() {
                    return;
                }
                let mut pending = Vec::with_capacity(3_000);
                loop {
                    match stop_rx.recv_timeout(Duration::from_millis(5)) {
                        Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                    }
                    let result = unsafe {
                        capture.drain(
                            &mut |samples| {
                                encoder.push(samples, &mut pending);
                                if pending.len() >= 2_400
                                    && on_audio.send(std::mem::take(&mut pending)).is_err()
                                {
                                    return Err("Audio receiver closed.");
                                }
                                Ok(())
                            },
                            &stop_rx,
                        )
                    };
                    if result.is_err() {
                        let _ = on_error.send("Windows output capture stopped. Check the selected device and try again.".into());
                        break;
                    }
                    if matches!(result, Ok(false)) {
                        break;
                    }
                }
            });
            match ready_rx.recv() {
                Ok(Ok(())) => Ok(Self {
                    stop,
                    thread: Some(thread),
                }),
                outcome => {
                    let _ = thread.join();
                    Err(outcome
                        .ok()
                        .and_then(Result::err)
                        .unwrap_or_else(|| "Windows audio capture did not start.".into()))
                }
            }
        }
    }

    impl Drop for Worker {
        fn drop(&mut self) {
            let _ = self.stop.send(());
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    struct ComGuard;
    impl Drop for ComGuard {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }
    struct MixGuard(*mut WAVEFORMATEX);
    impl Drop for MixGuard {
        fn drop(&mut self) {
            unsafe {
                CoTaskMemFree(Some(self.0.cast()));
            }
        }
    }

    struct Capture {
        client: IAudioClient,
        capture: IAudioCaptureClient,
        format: MixFormat,
        _com: ComGuard,
    }
    impl Capture {
        unsafe fn open(id: &str) -> Result<Self, String> {
            unsafe {
                CoInitializeEx(None, COINIT_MULTITHREADED)
                    .ok()
                    .map_err(|_| "Windows audio initialization failed.")?;
                let com = ComGuard;
                let enumerator: IMMDeviceEnumerator =
                    CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                        .map_err(|_| "Windows audio devices could not be opened.")?;
                let wide: Vec<u16> = id.encode_utf16().chain(Some(0)).collect();
                let device = enumerator
                    .GetDevice(windows::core::PCWSTR(wide.as_ptr()))
                    .map_err(|_| "The selected Windows output is no longer available.")?;
                if device
                    .GetState()
                    .map_err(|_| "Windows output state is unavailable.")?
                    != DEVICE_STATE_ACTIVE
                {
                    return Err("The selected Windows output is inactive.".into());
                }
                let endpoint: IMMEndpoint = device
                    .cast()
                    .map_err(|_| "The selected device is not an output.")?;
                if endpoint
                    .GetDataFlow()
                    .map_err(|_| "Windows output type is unavailable.")?
                    != eRender
                {
                    return Err("The selected device is not an output.".into());
                }
                let client: IAudioClient = device
                    .Activate(CLSCTX_ALL, None)
                    .map_err(|_| "The selected Windows output could not be opened.")?;
                let mix = MixGuard(
                    client
                        .GetMixFormat()
                        .map_err(|_| "Windows audio format is unavailable.")?,
                );
                let format = MixFormat::read(mix.0)?;
                client
                    .Initialize(
                        AUDCLNT_SHAREMODE_SHARED,
                        AUDCLNT_STREAMFLAGS_LOOPBACK,
                        1_000_000,
                        0,
                        mix.0,
                        None,
                    )
                    .map_err(|_| "Windows loopback capture could not be initialized.")?;
                let capture: IAudioCaptureClient = client
                    .GetService()
                    .map_err(|_| "Windows capture service is unavailable.")?;
                client
                    .Start()
                    .map_err(|_| "Windows output capture could not start.")?;
                Ok(Self {
                    client,
                    capture,
                    format,
                    _com: com,
                })
            }
        }

        unsafe fn drain(
            &mut self,
            on_packet: &mut impl FnMut(&[f32]) -> Result<(), &'static str>,
            stop: &mpsc::Receiver<()>,
        ) -> Result<bool, String> {
            unsafe {
                while self
                    .capture
                    .GetNextPacketSize()
                    .map_err(|_| "Audio packets are unavailable.")?
                    > 0
                {
                    if !matches!(stop.try_recv(), Err(mpsc::TryRecvError::Empty)) {
                        return Ok(false);
                    }
                    let (mut data, mut frames, mut flags) = (std::ptr::null_mut(), 0, 0);
                    self.capture
                        .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                        .map_err(|_| "Audio packet read failed.")?;
                    let decoded =
                        if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
                            Ok(vec![0.0; frames as usize * self.format.channels as usize])
                        } else {
                            let bytes = std::slice::from_raw_parts(
                                data,
                                frames as usize * self.format.block_align as usize,
                            );
                            self.format.decode(bytes)
                        };
                    self.capture
                        .ReleaseBuffer(frames)
                        .map_err(|_| "Audio packet release failed.")?;
                    on_packet(&decoded?).map_err(str::to_owned)?;
                }
                Ok(true)
            }
        }
    }
    impl Drop for Capture {
        fn drop(&mut self) {
            unsafe {
                let _ = self.client.Stop();
            }
        }
    }

    #[derive(Clone, Copy)]
    struct MixFormat {
        rate: u32,
        channels: u16,
        bits: u16,
        block_align: u16,
        float: bool,
    }
    impl MixFormat {
        unsafe fn read(pointer: *const WAVEFORMATEX) -> Result<Self, String> {
            unsafe {
                let wave = pointer.read_unaligned();
                let mut float = wave.wFormatTag == 3;
                if wave.wFormatTag == WAVE_FORMAT_EXTENSIBLE as u16 {
                    if wave.cbSize < 22 {
                        return Err("Invalid Windows output format.".into());
                    }
                    let ext = pointer.cast::<WAVEFORMATEXTENSIBLE>().read_unaligned();
                    let sub_format = ext.SubFormat;
                    if sub_format == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT {
                        float = true;
                    } else if sub_format != KSDATAFORMAT_SUBTYPE_PCM {
                        return Err("Unsupported Windows output format.".into());
                    }
                } else if !matches!(wave.wFormatTag, 1 | 3) {
                    return Err("Unsupported Windows output format.".into());
                }
                let format = Self {
                    rate: wave.nSamplesPerSec,
                    channels: wave.nChannels,
                    bits: wave.wBitsPerSample,
                    block_align: wave.nBlockAlign,
                    float,
                };
                if format.rate == 0
                    || format.channels == 0
                    || format.block_align != format.channels * format.bits / 8
                    || !(if float {
                        matches!(format.bits, 32 | 64)
                    } else {
                        matches!(format.bits, 8 | 16 | 24 | 32)
                    })
                {
                    return Err("Unsupported Windows output sample layout.".into());
                }
                Ok(format)
            }
        }

        fn decode(self, bytes: &[u8]) -> Result<Vec<f32>, String> {
            if bytes.len() % self.block_align as usize != 0 {
                return Err("Invalid Windows audio packet.".into());
            }
            let width = self.bits as usize / 8;
            Ok(bytes
                .chunks_exact(width)
                .map(|sample| {
                    let value = match (self.float, self.bits) {
                        (true, 32) => f32::from_le_bytes(sample.try_into().unwrap()),
                        (true, 64) => f64::from_le_bytes(sample.try_into().unwrap()) as f32,
                        (false, 8) => (sample[0] as f32 - 128.0) / 128.0,
                        (false, 16) => {
                            i16::from_le_bytes(sample.try_into().unwrap()) as f32 / 32768.0
                        }
                        (false, 24) => {
                            ((sample[0] as i32
                                | (sample[1] as i32) << 8
                                | (sample[2] as i32) << 16)
                                << 8
                                >> 8) as f32
                                / 8_388_608.0
                        }
                        (false, 32) => {
                            i32::from_le_bytes(sample.try_into().unwrap()) as f32 / 2_147_483_648.0
                        }
                        _ => 0.0,
                    };
                    if value.is_finite() {
                        value.clamp(-1.0, 1.0)
                    } else {
                        0.0
                    }
                })
                .collect())
        }
    }

    struct Encoder {
        rate: u32,
        channels: usize,
        phase: u32,
    }
    impl Encoder {
        fn new(rate: u32, channels: usize) -> Self {
            Self {
                rate,
                channels,
                phase: 0,
            }
        }
        fn push(&mut self, samples: &[f32], output: &mut Vec<i16>) {
            for frame in samples.chunks_exact(self.channels) {
                let mono = frame.iter().sum::<f32>() / self.channels as f32;
                self.phase += 24_000;
                while self.phase >= self.rate {
                    self.phase -= self.rate;
                    output.push((mono.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16);
                }
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        };

        #[test]
        fn dropping_worker_stops_and_joins_capture_thread() {
            let (stop, receiver) = mpsc::channel();
            let exited = Arc::new(AtomicBool::new(false));
            let flag = Arc::clone(&exited);
            let thread = thread::spawn(move || {
                let _ = receiver.recv();
                flag.store(true, Ordering::SeqCst);
            });
            drop(Worker {
                stop,
                thread: Some(thread),
            });
            assert!(exited.load(Ordering::SeqCst));
        }
        #[test]
        fn downmix_and_resample_stereo_without_microphone() {
            let mut encoder = Encoder::new(48_000, 2);
            let mut pcm = Vec::new();
            encoder.push(&[0.0, 0.0, 0.5, 0.5, 0.0, 0.0, -0.5, -0.5], &mut pcm);
            assert_eq!(pcm.len(), 2);
            assert!(pcm[0] > 0 && pcm[1] < 0);
        }
        #[test]
        fn float_packet_sanitizes_nonfinite_samples() {
            let format = MixFormat {
                rate: 48_000,
                channels: 2,
                bits: 32,
                block_align: 8,
                float: true,
            };
            let bytes: Vec<_> = [0.25f32, f32::NAN]
                .into_iter()
                .flat_map(f32::to_le_bytes)
                .collect();
            assert_eq!(format.decode(&bytes).unwrap(), vec![0.25, 0.0]);
        }
    }
}
