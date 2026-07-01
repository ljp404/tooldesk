use serde::Serialize;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const DOCKER_PULL_TIMEOUT_MS: u64 = 10 * 60 * 1000;
const DOCKER_SHORT_TIMEOUT_MS: u64 = 60 * 1000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DockerAvailability {
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DockerCommandResult {
    exit_code: i32,
    ok: bool,
    stderr: String,
    stdout: String,
}

#[cfg(windows)]
fn hide_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
}

#[cfg(not(windows))]
fn hide_window(_command: &mut Command) {}

fn run_process(
    command_name: &str,
    args: &[String],
    cwd: Option<String>,
    timeout_ms: u64,
) -> DockerCommandResult {
    let mut command = Command::new(command_name);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(cwd) = cwd.filter(|value| !value.trim().is_empty()) {
        command.current_dir(cwd);
    }

    hide_window(&mut command);

    let mut child = match command.spawn() {
        Ok(value) => value,
        Err(error) => {
            return DockerCommandResult {
                exit_code: 1,
                ok: false,
                stderr: error.to_string(),
                stdout: String::new(),
            };
        }
    };
    let started_at = Instant::now();

    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                break;
            }
            Ok(None) => {
                if started_at.elapsed() > Duration::from_millis(timeout_ms) {
                    let _ = child.kill();
                    let output = child.wait_with_output().ok();
                    return DockerCommandResult {
                        exit_code: 1,
                        ok: false,
                        stderr: output
                            .map(|value| String::from_utf8_lossy(&value.stderr).into_owned())
                            .filter(|value| !value.trim().is_empty())
                            .unwrap_or_else(|| "Docker 命令执行超时".to_string()),
                        stdout: String::new(),
                    };
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(error) => {
                let _ = child.kill();
                return DockerCommandResult {
                    exit_code: 1,
                    ok: false,
                    stderr: error.to_string(),
                    stdout: String::new(),
                };
            }
        }
    }

    match child.wait_with_output() {
        Ok(output) => {
            let exit_code = output.status.code().unwrap_or(1);
            DockerCommandResult {
                exit_code,
                ok: output.status.success(),
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
                stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            }
        }
        Err(error) => DockerCommandResult {
            exit_code: 1,
            ok: false,
            stderr: error.to_string(),
            stdout: String::new(),
        },
    }
}

fn run_docker_command(
    args: Vec<String>,
    cwd: Option<String>,
    timeout_ms: u64,
) -> DockerCommandResult {
    run_process("docker", &args, cwd, timeout_ms)
}

#[tauri::command]
pub(crate) fn check_docker_available() -> DockerAvailability {
    let result = run_docker_command(
        vec![
            "version".to_string(),
            "--format".to_string(),
            "{{.Server.Version}}".to_string(),
        ],
        None,
        DOCKER_SHORT_TIMEOUT_MS,
    );

    if !result.ok {
        return DockerAvailability {
            available: false,
            error: Some(
                result
                    .stderr
                    .trim()
                    .to_string()
                    .if_empty("未检测到 Docker，请确认已安装并启动 Docker Desktop"),
            ),
            version: None,
        };
    }

    DockerAvailability {
        available: true,
        error: None,
        version: Some(result.stdout.trim().to_string()),
    }
}

trait IfEmpty {
    fn if_empty(self, fallback: &str) -> String;
}

impl IfEmpty for String {
    fn if_empty(self, fallback: &str) -> String {
        if self.is_empty() {
            fallback.to_string()
        } else {
            self
        }
    }
}

#[tauri::command]
pub(crate) fn docker_image_exists(image: String) -> bool {
    let image = image.trim();

    if image.is_empty() {
        return false;
    }

    run_docker_command(
        vec![
            "image".to_string(),
            "inspect".to_string(),
            image.to_string(),
        ],
        None,
        DOCKER_SHORT_TIMEOUT_MS,
    )
    .ok
}

#[tauri::command]
pub(crate) fn docker_pull_image(image: String) -> Result<DockerCommandResult, String> {
    let image = image.trim();

    if image.is_empty() {
        return Err("镜像名称不能为空".to_string());
    }

    Ok(run_docker_command(
        vec!["pull".to_string(), image.to_string()],
        None,
        DOCKER_PULL_TIMEOUT_MS,
    ))
}

#[tauri::command]
pub(crate) fn docker_tag_image(
    source: String,
    target: String,
) -> Result<DockerCommandResult, String> {
    let source = source.trim();
    let target = target.trim();

    if source.is_empty() || target.is_empty() {
        return Err("镜像名称不能为空".to_string());
    }

    Ok(run_docker_command(
        vec!["tag".to_string(), source.to_string(), target.to_string()],
        None,
        DOCKER_SHORT_TIMEOUT_MS,
    ))
}

#[tauri::command]
pub(crate) fn run_docker_compose(
    compose_dir: String,
    args: Option<Vec<String>>,
) -> Result<DockerCommandResult, String> {
    let cwd = compose_dir.trim().to_string();
    let command_args = args
        .unwrap_or_else(|| vec!["up".to_string(), "-d".to_string()])
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();

    if cwd.is_empty() {
        return Err("Compose 目录不能为空".to_string());
    }

    let mut docker_args = vec!["compose".to_string()];
    docker_args.extend(command_args.clone());

    Ok(run_docker_command(
        docker_args,
        Some(cwd),
        DOCKER_PULL_TIMEOUT_MS,
    ))
}
