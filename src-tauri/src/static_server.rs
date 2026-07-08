use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use axum::Router;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tower_http::services::{ServeDir, ServeFile};

use crate::storage;

#[derive(Default)]
pub(crate) struct StaticServerRuntimeState(Mutex<StaticServerInner>);

#[derive(Default)]
struct StaticServerInner {
    running: Option<RunningServer>,
}

struct RunningServer {
    root: PathBuf,
    host: String,
    port: u16,
    spa_fallback: bool,
    shutdown: oneshot::Sender<()>,
    task: JoinHandle<()>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartStaticServerPayload {
    root_path: String,
    port: u16,
    #[serde(default = "default_host")]
    host: String,
    #[serde(default)]
    spa_fallback: bool,
}

fn default_host() -> String {
    "127.0.0.1".to_string()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StaticServerStatus {
    running: bool,
    root: Option<String>,
    host: Option<String>,
    port: Option<u16>,
    spa_fallback: Option<bool>,
    url: Option<String>,
}

fn normalize_root(root_path: &str) -> Result<PathBuf, String> {
    let trimmed = root_path.trim();
    if trimmed.is_empty() {
        return Err("请选择静态文件目录".into());
    }

    let path = PathBuf::from(trimmed);
    if !path.is_dir() {
        return Err(format!(
            "目录不存在或不可用：{}",
            storage::path_to_string(&path)
        ));
    }

    Ok(path)
}

fn normalize_host(host: &str) -> Result<String, String> {
    let trimmed = host.trim();
    if trimmed.is_empty() {
        return Err("绑定地址无效".into());
    }

    match trimmed {
        "127.0.0.1" | "0.0.0.0" | "localhost" => Ok(trimmed.to_string()),
        _ => Err("仅支持 127.0.0.1 或 0.0.0.0".into()),
    }
}

fn validate_port(port: u16) -> Result<(), String> {
    if port == 0 {
        return Err("端口号无效".into());
    }

    Ok(())
}

fn build_url(host: &str, port: u16) -> String {
    let display_host = if host == "0.0.0.0" { "127.0.0.1" } else { host };
    format!("http://{display_host}:{port}/")
}

fn status_from_running(running: &RunningServer) -> StaticServerStatus {
    StaticServerStatus {
        running: true,
        root: Some(storage::path_to_string(&running.root)),
        host: Some(running.host.clone()),
        port: Some(running.port),
        spa_fallback: Some(running.spa_fallback),
        url: Some(build_url(&running.host, running.port)),
    }
}

fn stopped_status() -> StaticServerStatus {
    StaticServerStatus {
        running: false,
        root: None,
        host: None,
        port: None,
        spa_fallback: None,
        url: None,
    }
}

async fn shutdown_running(running: RunningServer) {
    let _ = running.shutdown.send(());
    let _ = tokio::time::timeout(Duration::from_secs(2), running.task).await;
}

#[tauri::command]
pub(crate) async fn start_static_server(
    state: State<'_, StaticServerRuntimeState>,
    payload: StartStaticServerPayload,
) -> Result<StaticServerStatus, String> {
    let root = normalize_root(&payload.root_path)?;
    validate_port(payload.port)?;
    let host = normalize_host(&payload.host)?;

    if payload.spa_fallback {
        let index = root.join("index.html");
        if !index.is_file() {
            return Err(format!(
                "未找到 index.html：{}",
                storage::path_to_string(&index)
            ));
        }
    }

    let addr: SocketAddr = format!("{host}:{}", payload.port)
        .parse()
        .map_err(|_| "绑定地址无效".to_string())?;

    let listener = TcpListener::bind(addr)
        .await
        .map_err(|error| format!("端口 {} 绑定失败：{error}", payload.port))?;

    let previous = {
        let mut inner = state.0.lock().map_err(|_| "服务状态不可用".to_string())?;
        inner.running.take()
    };

    if let Some(running) = previous {
        shutdown_running(running).await;
    }

    let root_for_serve = root.clone();
    let spa_fallback = payload.spa_fallback;
    let (shutdown_tx, shutdown_rx) = oneshot::channel();

    let task = tokio::spawn(async move {
        let graceful_shutdown = async {
            shutdown_rx.await.ok();
        };

        if spa_fallback {
            let index_path = root_for_serve.join("index.html");
            let app = Router::new().fallback_service(
                ServeDir::new(root_for_serve).fallback(ServeFile::new(index_path)),
            );

            if let Err(error) = axum::serve(listener, app)
                .with_graceful_shutdown(graceful_shutdown)
                .await
            {
                eprintln!("static server stopped with error: {error}");
            }
            return;
        }

        let app = Router::new().fallback_service(ServeDir::new(root_for_serve));

        if let Err(error) = axum::serve(listener, app)
            .with_graceful_shutdown(graceful_shutdown)
            .await
        {
            eprintln!("static server stopped with error: {error}");
        }
    });

    let status = StaticServerStatus {
        running: true,
        root: Some(storage::path_to_string(&root)),
        host: Some(host.clone()),
        port: Some(payload.port),
        spa_fallback: Some(spa_fallback),
        url: Some(build_url(&host, payload.port)),
    };

    {
        let mut inner = state.0.lock().map_err(|_| "服务状态不可用".to_string())?;
        inner.running = Some(RunningServer {
            root,
            host,
            port: payload.port,
            spa_fallback,
            shutdown: shutdown_tx,
            task,
        });
    }

    Ok(status)
}

#[tauri::command]
pub(crate) async fn stop_static_server(
    state: State<'_, StaticServerRuntimeState>,
) -> Result<StaticServerStatus, String> {
    let running = {
        let mut inner = state.0.lock().map_err(|_| "服务状态不可用".to_string())?;
        inner.running.take()
    };

    if let Some(running) = running {
        shutdown_running(running).await;
    }

    Ok(stopped_status())
}

#[tauri::command]
pub(crate) fn get_static_server_status(
    state: State<'_, StaticServerRuntimeState>,
) -> Result<StaticServerStatus, String> {
    let mut inner = state.0.lock().map_err(|_| "服务状态不可用".to_string())?;

    if let Some(running) = inner.running.as_ref() {
        if running.task.is_finished() {
            inner.running = None;
            return Ok(stopped_status());
        }

        return Ok(status_from_running(running));
    }

    Ok(stopped_status())
}

pub(crate) async fn stop_on_app_exit(app: &AppHandle) {
    let state = app.state::<StaticServerRuntimeState>();
    let running = {
        let mut inner = match state.0.lock() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        inner.running.take()
    };

    if let Some(running) = running {
        shutdown_running(running).await;
    }
}
