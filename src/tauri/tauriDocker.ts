import { invoke } from '@tauri-apps/api/core';

type DockerCommandResult = {
  exitCode: number;
  ok: boolean;
  stderr: string;
  stdout: string;
};

export function checkDockerAvailable(): Promise<{ available: boolean; error?: string; version?: string }> {
  return invoke('check_docker_available');
}

export function dockerImageExists(image: string): Promise<boolean> {
  return invoke('docker_image_exists', { image });
}

export function dockerPullImage(image: string): Promise<DockerCommandResult> {
  return invoke('docker_pull_image', { image });
}

export function dockerTagImage(source: string, target: string): Promise<DockerCommandResult> {
  return invoke('docker_tag_image', { source, target });
}

export function runDockerCompose(composeDir: string, args?: string[]): Promise<DockerCommandResult> {
  return invoke('run_docker_compose', { args, composeDir });
}
