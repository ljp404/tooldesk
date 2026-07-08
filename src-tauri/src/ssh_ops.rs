use russh::client::{self, Config, Handler};
use russh::keys::ssh_key;
use russh::{ChannelMsg, CryptoVec};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::time::{timeout, Duration};

const SSH_DEFAULT_TIMEOUT_MS: u64 = 10 * 60 * 1000;
const SSH_TEST_TIMEOUT_MS: u64 = 20 * 1000;
const SSH_OUTPUT_EVENT: &str = "ssh:exec-output";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SshConnectionPayload {
    host: Option<String>,
    password: Option<String>,
    port: Option<serde_json::Value>,
    username: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SshExecOptions {
    timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SshExecResult {
    exit_code: i32,
    ok: bool,
    stderr: String,
    stdout: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SshExecOutput {
    line: String,
    stream: String,
}

#[derive(Clone, Debug)]
struct NormalizedSshConfig {
    address: String,
    password: String,
    username: String,
}

#[derive(Clone)]
struct TrustAllServerKeys;

impl Handler for TrustAllServerKeys {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

fn normalize_config(payload: SshConnectionPayload) -> Result<NormalizedSshConfig, String> {
    let host = payload.host.unwrap_or_default().trim().to_string();
    let username = payload.username.unwrap_or_default().trim().to_string();
    let password = payload.password.unwrap_or_default();
    let port = match payload.port {
        Some(serde_json::Value::Number(value)) => value.as_u64().unwrap_or(22),
        Some(serde_json::Value::String(value)) => value.parse::<u64>().unwrap_or(22),
        _ => 22,
    }
    .clamp(1, 65_535);

    if host.is_empty() {
        return Err("SSH 主机不能为空".to_string());
    }

    if username.is_empty() {
        return Err("SSH 用户名不能为空".to_string());
    }

    Ok(NormalizedSshConfig {
        address: format!("{host}:{port}"),
        password,
        username,
    })
}

fn validate_command(command: &str) -> Result<(), String> {
    if command.trim().is_empty() {
        return Err("SSH 命令不能为空".to_string());
    }

    if command.contains('\0') || command.contains('\r') || command.contains('\n') {
        return Err("SSH 命令格式无效".to_string());
    }

    if command.len() > 16_000 {
        return Err("SSH 命令过长".to_string());
    }

    Ok(())
}

fn normalize_timeout(options: Option<SshExecOptions>) -> u64 {
    options
        .and_then(|value| value.timeout_ms)
        .unwrap_or(SSH_DEFAULT_TIMEOUT_MS)
        .max(1000)
}

fn append_output(buffer: &mut String, data: &CryptoVec, stream: &str, app: Option<&AppHandle>) {
    let chunk = String::from_utf8_lossy(data);
    buffer.push_str(&chunk);

    if let Some(app) = app {
        for line in chunk.lines().map(str::trim).filter(|line| !line.is_empty()) {
            let _ = app.emit(
                SSH_OUTPUT_EVENT,
                SshExecOutput {
                    line: line.to_string(),
                    stream: stream.to_string(),
                },
            );
        }
    }
}

async fn connect_ssh(
    config: &NormalizedSshConfig,
) -> Result<client::Handle<TrustAllServerKeys>, String> {
    let mut session = client::connect(
        Arc::new(Config::default()),
        config.address.as_str(),
        TrustAllServerKeys,
    )
    .await
    .map_err(|error| error.to_string())?;
    let auth_result = session
        .authenticate_password(config.username.clone(), config.password.clone())
        .await
        .map_err(|error| error.to_string())?;

    if auth_result.success() {
        Ok(session)
    } else {
        Err("SSH 认证失败".to_string())
    }
}

async fn exec_ssh_command(
    payload: SshConnectionPayload,
    command: String,
    options: Option<SshExecOptions>,
    app: Option<AppHandle>,
) -> Result<SshExecResult, String> {
    validate_command(&command)?;
    let config = normalize_config(payload)?;
    let timeout_ms = normalize_timeout(options);

    timeout(Duration::from_millis(timeout_ms), async move {
        let session = connect_ssh(&config).await?;
        let mut channel = session
            .channel_open_session()
            .await
            .map_err(|error| error.to_string())?;
        let mut stdout = String::new();
        let mut stderr = String::new();
        let mut exit_code = 1_i32;

        channel
            .exec(false, command)
            .await
            .map_err(|error| error.to_string())?;

        while let Some(message) = channel.wait().await {
            match message {
                ChannelMsg::Data { data } => {
                    append_output(&mut stdout, &data, "stdout", app.as_ref());
                }
                ChannelMsg::ExtendedData { data, .. } => {
                    append_output(&mut stderr, &data, "stderr", app.as_ref());
                }
                ChannelMsg::ExitStatus { exit_status } => {
                    exit_code = exit_status as i32;
                }
                ChannelMsg::Close | ChannelMsg::Eof => {
                    break;
                }
                _ => {}
            }
        }

        let _ = channel.close().await;

        Ok(SshExecResult {
            exit_code,
            ok: exit_code == 0,
            stderr,
            stdout,
        })
    })
    .await
    .map_err(|_| format!("SSH 命令执行超时（{} 秒）", timeout_ms / 1000))?
}

#[tauri::command]
pub(crate) async fn test_ssh_connection(
    config: SshConnectionPayload,
) -> Result<serde_json::Value, String> {
    let result = exec_ssh_command(
        config,
        "echo __tooldesk_ok__".to_string(),
        Some(SshExecOptions {
            timeout_ms: Some(SSH_TEST_TIMEOUT_MS),
        }),
        None,
    )
    .await;

    match result {
        Ok(value) => {
            let ok = value.ok && value.stdout.contains("__tooldesk_ok__");
            Ok(serde_json::json!({
                "message": if ok { "SSH 连接成功" } else { value.stderr.trim() },
                "ok": ok
            }))
        }
        Err(error) => Ok(serde_json::json!({
            "message": error,
            "ok": false
        })),
    }
}

#[tauri::command]
pub(crate) async fn ssh_exec(
    config: SshConnectionPayload,
    command: String,
    options: Option<SshExecOptions>,
) -> Result<SshExecResult, String> {
    exec_ssh_command(config, command, options, None).await
}

#[tauri::command]
pub(crate) async fn ssh_exec_stream(
    app: AppHandle,
    config: SshConnectionPayload,
    command: String,
    options: Option<SshExecOptions>,
) -> Result<SshExecResult, String> {
    exec_ssh_command(config, command, options, Some(app)).await
}
