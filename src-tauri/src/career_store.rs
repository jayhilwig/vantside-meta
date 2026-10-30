use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{fs, path::Path, time::Duration};
use tauri::Manager;

const MIGRATION_1: &str = include_str!("../migrations/001_career_memory.sql");
const MIGRATION_2: &str = include_str!("../migrations/002_opportunity_intelligence.sql");
const FILE_NAME: &str = "career-memory.sqlite3";

fn storage_error() -> String {
    "Career Memory could not be saved or opened. Your previous saved data was not replaced.".into()
}

fn open_at(path: &Path) -> Result<Connection, String> {
    fs::create_dir_all(path.parent().ok_or_else(storage_error)?).map_err(|_| storage_error())?;
    #[cfg(unix)]
    fs::set_permissions(
        path.parent().ok_or_else(storage_error)?,
        fs::Permissions::from_mode(0o700),
    )
    .map_err(|_| storage_error())?;
    let mut connection = Connection::open(path).map_err(|_| storage_error())?;
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|_| storage_error())?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|_| storage_error())?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|_| storage_error())?;
    connection
        .pragma_update(None, "synchronous", "FULL")
        .map_err(|_| storage_error())?;
    connection
        .pragma_update(None, "secure_delete", "ON")
        .map_err(|_| storage_error())?;
    migrate(&mut connection).map_err(|_| storage_error())?;
    Ok(connection)
}

fn migrate(connection: &mut Connection) -> rusqlite::Result<()> {
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version > 2 {
        return Err(rusqlite::Error::InvalidQuery);
    }
    if version == 0 {
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute_batch(MIGRATION_1)?;
        tx.pragma_update(None, "user_version", 1)?;
        tx.commit()?;
    }
    if version <= 1 {
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute_batch(MIGRATION_2)?;
        tx.pragma_update(None, "user_version", 2)?;
        tx.commit()?;
    }
    Ok(())
}

fn array<'a>(value: &'a Value, key: &str) -> rusqlite::Result<&'a Vec<Value>> {
    value
        .get(key)
        .and_then(Value::as_array)
        .ok_or(rusqlite::Error::InvalidQuery)
}

fn field<'a>(value: &'a Value, key: &str) -> rusqlite::Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or(rusqlite::Error::InvalidQuery)
}

fn payload(value: &Value) -> rusqlite::Result<String> {
    serde_json::to_string(value).map_err(|_| rusqlite::Error::InvalidQuery)
}

fn insert_plain(
    tx: &rusqlite::Transaction<'_>,
    table: &str,
    records: &[Value],
) -> rusqlite::Result<()> {
    let sql = format!("INSERT INTO {table} (id, payload) VALUES (?1, ?2)");
    for item in records {
        tx.execute(&sql, params![field(item, "id")?, payload(item)?])?;
    }
    Ok(())
}

fn insert_with_parent(
    tx: &rusqlite::Transaction<'_>,
    table: &str,
    parent_column: &str,
    records: &[Value],
    parent_key: &str,
) -> rusqlite::Result<()> {
    let sql = format!("INSERT INTO {table} (id, {parent_column}, payload) VALUES (?1, ?2, ?3)");
    for item in records {
        tx.execute(
            &sql,
            params![field(item, "id")?, field(item, parent_key)?, payload(item)?],
        )?;
    }
    Ok(())
}

fn save_at(
    connection: &mut Connection,
    state: &Value,
    expected_revision: i64,
) -> rusqlite::Result<i64> {
    if state
        .get("career")
        .and_then(|career| career.get("version"))
        .and_then(Value::as_i64)
        != Some(1)
    {
        return Err(rusqlite::Error::InvalidQuery);
    }
    let career = &state["career"];
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let revision: i64 = tx.query_row(
        "SELECT revision FROM storage_revision WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    if revision != expected_revision {
        return Err(rusqlite::Error::InvalidQuery);
    }
    tx.execute_batch("DELETE FROM professional_identity; DELETE FROM identity_sources; DELETE FROM proposal_sources;
      DELETE FROM memory_proposals; DELETE FROM fact_sources; DELETE FROM career_facts;
      DELETE FROM interview_rounds; DELETE FROM job_opportunities; DELETE FROM evidence_sources;
      DELETE FROM career_projects; DELETE FROM foundational_sessions; DELETE FROM career_materials;")?;

    for material in array(career, "materials")? {
        tx.execute(
            "INSERT INTO career_materials (id, kind, payload) VALUES (?1, ?2, ?3)",
            params![
                field(material, "id")?,
                field(material, "kind")?,
                payload(material)?
            ],
        )?;
    }
    insert_plain(&tx, "foundational_sessions", array(state, "sessions")?)?;
    insert_plain(&tx, "career_projects", array(career, "projects")?)?;
    insert_plain(&tx, "job_opportunities", array(state, "opportunities")?)?;
    insert_with_parent(
        &tx,
        "interview_rounds",
        "opportunity_id",
        array(state, "rounds")?,
        "opportunityId",
    )?;

    for source in array(career, "sources")? {
        let kind = field(source, "kind")?;
        let origin = field(source, "originId")?;
        let (material_id, session_id) = if kind == "interview" {
            (None, Some(origin))
        } else {
            (Some(origin), None)
        };
        tx.execute("INSERT INTO evidence_sources (id, kind, material_id, session_id, payload) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![field(source, "id")?, kind, material_id, session_id, payload(source)?])?;
    }
    for fact in array(career, "facts")? {
        let fact_id = field(fact, "id")?;
        tx.execute(
            "INSERT INTO career_facts (id, project_id, payload) VALUES (?1, ?2, ?3)",
            params![fact_id, field(fact, "projectId")?, payload(fact)?],
        )?;
        for source_id in array(fact, "sourceIds")? {
            tx.execute(
                "INSERT INTO fact_sources (fact_id, source_id) VALUES (?1, ?2)",
                params![
                    fact_id,
                    source_id.as_str().ok_or(rusqlite::Error::InvalidQuery)?
                ],
            )?;
        }
    }
    if !career["identity"].is_null() {
        let identity = &career["identity"];
        tx.execute(
            "INSERT INTO professional_identity (singleton, payload) VALUES (1, ?1)",
            params![payload(identity)?],
        )?;
        for source_id in array(identity, "sourceIds")? {
            tx.execute(
                "INSERT INTO identity_sources (source_id) VALUES (?1)",
                params![source_id.as_str().ok_or(rusqlite::Error::InvalidQuery)?],
            )?;
        }
    }
    for proposal in array(state, "proposals")? {
        let proposal_id = field(proposal, "id")?;
        tx.execute(
            "INSERT INTO memory_proposals (id, origin_session_id, opportunity_id, payload) VALUES (?1, ?2, ?3, ?4)",
            params![
                proposal_id,
                proposal.get("originSessionId").and_then(Value::as_str),
                proposal.get("opportunityId").and_then(Value::as_str),
                payload(proposal)?
            ],
        )?;
        for source_id in array(proposal, "sourceIds")? {
            tx.execute(
                "INSERT INTO proposal_sources (proposal_id, source_id) VALUES (?1, ?2)",
                params![
                    proposal_id,
                    source_id.as_str().ok_or(rusqlite::Error::InvalidQuery)?
                ],
            )?;
        }
    }
    tx.execute(
        "UPDATE storage_revision SET revision = revision + 1 WHERE singleton = 1",
        [],
    )?;
    tx.commit()?;
    Ok(revision + 1)
}

fn records(connection: &Connection, table: &str) -> rusqlite::Result<Vec<Value>> {
    let mut statement =
        connection.prepare(&format!("SELECT id, payload FROM {table} ORDER BY rowid"))?;
    let rows = statement.query_map([], |row| {
        let id: String = row.get(0)?;
        let raw: String = row.get(1)?;
        let value: Value = serde_json::from_str(&raw).map_err(|_| rusqlite::Error::InvalidQuery)?;
        if value.get("id").and_then(Value::as_str) != Some(id.as_str()) {
            return Err(rusqlite::Error::InvalidQuery);
        }
        Ok(value)
    })?;
    rows.collect()
}

fn load_at(connection: &Connection) -> rusqlite::Result<Value> {
    let revision: i64 = connection.query_row(
        "SELECT revision FROM storage_revision WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    let identity: Option<String> = connection
        .query_row(
            "SELECT payload FROM professional_identity WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    let identity = identity
        .map(|raw| serde_json::from_str::<Value>(&raw).map_err(|_| rusqlite::Error::InvalidQuery))
        .transpose()?
        .unwrap_or(Value::Null);
    Ok(json!({
        "revision": revision,
        "state": {
            "career": { "version": 1, "identity": identity,
                "materials": records(connection, "career_materials")?,
                "sources": records(connection, "evidence_sources")?,
                "projects": records(connection, "career_projects")?,
                "facts": records(connection, "career_facts")? },
            "sessions": records(connection, "foundational_sessions")?,
            "opportunities": records(connection, "job_opportunities")?,
            "rounds": records(connection, "interview_rounds")?,
            "proposals": records(connection, "memory_proposals")?
        }
    }))
}

#[tauri::command]
pub async fn load_career_memory(app: tauri::AppHandle) -> Result<Value, String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|_| storage_error())?
        .join(FILE_NAME);
    tauri::async_runtime::spawn_blocking(move || {
        let mut connection = open_at(&path)?;
        let snapshot = connection.transaction().map_err(|_| storage_error())?;
        let result = load_at(&snapshot).map_err(|_| storage_error())?;
        snapshot.commit().map_err(|_| storage_error())?;
        Ok(result)
    })
    .await
    .map_err(|_| storage_error())?
}

#[tauri::command]
pub async fn save_career_memory(
    app: tauri::AppHandle,
    state: Value,
    expected_revision: i64,
) -> Result<i64, String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|_| storage_error())?
        .join(FILE_NAME);
    tauri::async_runtime::spawn_blocking(move || {
        let mut connection = open_at(&path)?;
        save_at(&mut connection, &state, expected_revision).map_err(|_| storage_error())
    })
    .await
    .map_err(|_| storage_error())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upgrades_existing_v1_opportunity_without_data_loss() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(MIGRATION_1).unwrap();
        connection.pragma_update(None, "user_version", 1).unwrap();
        connection.execute("INSERT INTO job_opportunities (id, payload) VALUES (?1, ?2)",
            params!["old-job", r#"{"id":"old-job","company":"Example","role":"Designer","description":"Existing job text","confirmedAt":"2026-10-28T00:00:00Z"}"#]).unwrap();
        connection.execute("INSERT INTO career_materials (id, kind, payload) VALUES (?1, ?2, ?3)",
            params!["old-resume", "resume", r#"{"id":"old-resume","kind":"resume","label":"Resume","addedAt":"2026-10-28T00:00:00Z"}"#]).unwrap();
        connection
            .execute(
                "INSERT INTO career_projects (id, payload) VALUES (?1, ?2)",
                params![
                    "old-project",
                    r#"{"id":"old-project","title":"Onboarding"}"#
                ],
            )
            .unwrap();
        migrate(&mut connection).unwrap();
        assert_eq!(
            load_at(&connection).unwrap()["state"]["opportunities"][0]["id"],
            "old-job"
        );
        assert_eq!(
            load_at(&connection).unwrap()["state"]["career"]["materials"][0]["id"],
            "old-resume"
        );
        assert_eq!(
            load_at(&connection).unwrap()["state"]["career"]["projects"][0]["id"],
            "old-project"
        );
        assert_eq!(
            connection
                .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            2
        );
    }

    fn sample() -> Value {
        json!({"career":{"version":1,"identity":{"profession":"Product designer","seniority":"Senior","careerSummary":"Led onboarding work for a product team.","sourceIds":["source-1"],"approvedAt":"2026-10-28T00:00:00Z"},"materials":[{"id":"resume-1","kind":"resume","label":"Resume","addedAt":"2026-10-28T00:00:00Z"}],
          "sources":[{"id":"source-1","kind":"resume","originId":"resume-1","label":"Resume","excerpt":"Led onboarding work","capturedAt":"2026-10-28T00:00:00Z"},
                     {"id":"source-2","kind":"interview","originId":"session-1","label":"Interview answer","excerpt":"I worked with support","capturedAt":"2026-10-28T00:00:00Z"}],
          "projects":[{"id":"project-1","title":"Onboarding"}],
          "facts":[{"id":"fact-1","projectId":"project-1","kind":"role","text":"Led onboarding work","sourceIds":["source-1"],"approvedAt":"2026-10-28T00:00:00Z"}]},
          "sessions":[{"id":"session-1","status":"paused","startedAt":"2026-10-28T00:00:00Z"}],
          "opportunities":[{"id":"job-1","company":"Example","role":"Designer","description":"Design onboarding","confirmedAt":"2026-10-28T00:00:00Z",
            "sourceLabel":"Pasted job description","requirements":[{"id":"req-1","kind":"responsibility","text":"Design onboarding flows","sourceExcerpt":"Design onboarding flows"}],
            "alignment":{"strengths":[{"requirementId":"req-1","factId":"fact-1"}],"needsEvidence":[]},
            "preparationQuestions":["Tell me about onboarding flows you designed."]}],
          "rounds":[{"id":"round-1","opportunityId":"job-1","label":"First round","status":"planned"}],
          "proposals":[{"id":"proposal-1","projectId":"project-1","projectTitle":"Onboarding","kind":"role","text":"Worked with support","sourceIds":["source-2"],"originSessionId":"session-1","proposedAt":"2026-10-28T00:00:00Z"}]})
    }

    #[test]
    fn migration_save_restart_and_idempotent_replacement() {
        let path = std::env::temp_dir().join(format!(
            "vantside-test-{}-{}.sqlite3",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut connection = open_at(&path).unwrap();
        assert_eq!(
            connection
                .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            2
        );
        assert_eq!(load_at(&connection).unwrap()["revision"], 0);
        assert_eq!(save_at(&mut connection, &sample(), 0).unwrap(), 1);
        drop(connection);
        let mut restarted = open_at(&path).unwrap();
        assert_eq!(
            load_at(&restarted).unwrap()["state"]["career"]["facts"][0]["id"],
            "fact-1"
        );
        assert_eq!(
            load_at(&restarted).unwrap()["state"]["career"]["identity"]["profession"],
            "Product designer"
        );
        assert_eq!(
            load_at(&restarted).unwrap()["state"]["proposals"][0]["sourceIds"][0],
            "source-2"
        );
        assert_eq!(
            load_at(&restarted).unwrap()["state"]["rounds"][0]["opportunityId"],
            "job-1"
        );
        assert_eq!(
            load_at(&restarted).unwrap()["state"]["opportunities"][0]["requirements"][0]["sourceExcerpt"],
            "Design onboarding flows"
        );
        assert_eq!(
            load_at(&restarted).unwrap()["state"]["opportunities"][0]["alignment"]["strengths"][0]["factId"],
            "fact-1"
        );
        assert_eq!(
            load_at(&restarted).unwrap()["state"]["opportunities"][0]["preparationQuestions"][0],
            "Tell me about onboarding flows you designed."
        );
        assert_eq!(save_at(&mut restarted, &sample(), 1).unwrap(), 2);
        assert_eq!(
            load_at(&restarted).unwrap()["state"]["career"]["facts"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let empty = json!({"career":{"version":1,"identity":null,"materials":[],"sources":[],"projects":[],"facts":[]},
            "sessions":[],"opportunities":[],"rounds":[],"proposals":[]});
        assert_eq!(save_at(&mut restarted, &empty, 2).unwrap(), 3);
        drop(restarted);
        let after_start_over = open_at(&path).unwrap();
        let restored = load_at(&after_start_over).unwrap();
        for (domain, key) in [
            ("career", "materials"),
            ("career", "sources"),
            ("career", "facts"),
            ("state", "sessions"),
            ("state", "opportunities"),
            ("state", "proposals"),
        ] {
            let records = if domain == "career" {
                &restored["state"]["career"][key]
            } else {
                &restored["state"][key]
            };
            assert_eq!(records.as_array().unwrap().len(), 0);
        }
        drop(after_start_over);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn manually_approved_fact_and_user_source_survive_restart() {
        let path = std::env::temp_dir().join(format!(
            "vantside-manual-{}-{}.sqlite3",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut state = sample();
        let career = &mut state["career"];
        career["materials"].as_array_mut().unwrap().push(json!({"id":"manual-1","kind":"user_material","label":"User-entered Career Memory","addedAt":"2026-10-28T00:00:00Z"}));
        career["sources"].as_array_mut().unwrap().push(json!({"id":"manual-source","kind":"user_material","originId":"manual-1","label":"User-provided supporting fact","excerpt":"Led the redesign","capturedAt":"2026-10-28T00:00:00Z"}));
        career["projects"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":"manual-project","title":"Design lead"}));
        career["facts"].as_array_mut().unwrap().push(json!({"id":"manual-fact","projectId":"manual-project","kind":"accomplishment","text":"Led the redesign","sourceIds":["manual-source"],"approvedAt":"2026-10-28T00:00:00Z"}));
        let mut connection = open_at(&path).unwrap();
        save_at(&mut connection, &state, 0).unwrap();
        drop(connection);
        let reopened = open_at(&path).unwrap();
        let restored = load_at(&reopened).unwrap();
        assert!(
            restored["state"]["career"]["facts"]
                .as_array()
                .unwrap()
                .iter()
                .any(|fact| fact["id"] == "manual-fact" && fact["sourceIds"][0] == "manual-source")
        );
        assert!(
            restored["state"]["career"]["sources"]
                .as_array()
                .unwrap()
                .iter()
                .any(|source| source["id"] == "manual-source" && source["originId"] == "manual-1")
        );
        drop(reopened);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn malformed_or_interrupted_write_keeps_prior_state() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .unwrap();
        migrate(&mut connection).unwrap();
        save_at(&mut connection, &sample(), 0).unwrap();
        let mut bad = sample();
        bad["career"]["facts"][0]["sourceIds"] = json!(["missing-source"]);
        assert!(save_at(&mut connection, &bad, 1).is_err());
        assert_eq!(load_at(&connection).unwrap()["revision"], 1);
        assert_eq!(
            load_at(&connection).unwrap()["state"]["career"]["facts"][0]["sourceIds"][0],
            "source-1"
        );
        assert!(save_at(&mut connection, &sample(), 0).is_err());
        connection
            .execute(
                "UPDATE career_facts SET payload = '{}' WHERE id = 'fact-1'",
                [],
            )
            .unwrap();
        assert!(load_at(&connection).is_err());
    }

    #[test]
    fn deleting_opportunity_cascades_round_without_touching_career() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .unwrap();
        migrate(&mut connection).unwrap();
        let mut state = sample();
        state["opportunities"].as_array_mut().unwrap().push(json!({
            "id":"job-2","company":"Another company","role":"Researcher",
            "description":"Research customer needs","confirmedAt":"2026-10-28T00:00:00Z"
        }));
        state["rounds"].as_array_mut().unwrap().push(json!({
            "id":"round-2","opportunityId":"job-2","label":"Research round","status":"planned"
        }));
        save_at(&mut connection, &state, 0).unwrap();
        connection
            .execute("DELETE FROM job_opportunities WHERE id = 'job-1'", [])
            .unwrap();
        assert_eq!(records(&connection, "interview_rounds").unwrap().len(), 1);
        assert_eq!(
            records(&connection, "job_opportunities").unwrap()[0]["id"],
            "job-2"
        );
        assert_eq!(records(&connection, "career_facts").unwrap().len(), 1);
    }
}
