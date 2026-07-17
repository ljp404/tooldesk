import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type TauriSshConfig = {
  host?: string;
  password?: string;
  port?: number | string;
  username?: string;
};

export type TauriSshExecOptions = {
  idleTimeoutMs?: number;
  timeoutMs?: number;
};

export type TauriSshExecResult = {
  exitCode: number;
  ok: boolean;
  stderr: string;
  stdout: string;
};

export type TauriSshOutputChunk = {
  line: string;
  stream: 'stderr' | 'stdout';
};

const SSH_OUTPUT_EVENT = 'ssh:exec-output';

export function testSshConnection(config: TauriSshConfig) {
  return invoke<{ message: string; ok: boolean }>('test_ssh_connection', { config });
}

export function sshExec(config: TauriSshConfig, command: string, options?: TauriSshExecOptions) {
  return invoke<TauriSshExecResult>('ssh_exec', { command, config, options });
}

export function sshExecStream(config: TauriSshConfig, command: string, options?: TauriSshExecOptions) {
  return invoke<TauriSshExecResult>('ssh_exec_stream', { command, config, options });
}

export function onSshExecOutput(callback: (chunk: TauriSshOutputChunk) => void) {
  let unlisten: (() => void) | undefined;
  void listen<TauriSshOutputChunk>(SSH_OUTPUT_EVENT, (event) => {
    const payload = event.payload;

    if (payload?.line && (payload.stream === 'stdout' || payload.stream === 'stderr')) {
      callback(payload);
    }
  }).then((value) => {
    unlisten = value;
  });

  return () => {
    unlisten?.();
  };
}
