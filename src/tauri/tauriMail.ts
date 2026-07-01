import { invoke } from '@tauri-apps/api/core';

export function fetchMailMessages(account: TooldeskMailAccountConfig, options?: { folder?: string; limit?: number }) {
  return invoke<TooldeskMailFetchResult>('fetch_mail_messages', { account, options });
}

export function listMailFolders(account: TooldeskMailAccountConfig) {
  return invoke<TooldeskMailFolderSummary[]>('list_mail_folders', { account });
}

export function downloadMailAttachment(
  account: TooldeskMailAccountConfig,
  message: { uid: number },
  attachment: { filename?: string; index?: number }
) {
  return invoke<TooldeskMailAttachmentDownloadResult>('download_mail_attachment', {
    account,
    attachment,
    message
  });
}

export function setMailMessageSeen(
  account: TooldeskMailAccountConfig,
  message: { uid: number },
  seen: boolean
) {
  return invoke<{ seen: boolean; success: boolean }>('set_mail_message_seen', {
    account,
    message,
    seen
  });
}

export function deleteMailMessage(
  account: TooldeskMailAccountConfig,
  message: { uid: number }
) {
  return invoke<{ success: boolean }>('delete_mail_message', {
    account,
    message
  });
}

export function sendMailMessage(
  account: TooldeskMailAccountConfig,
  payload: TooldeskMailSendPayload
) {
  return invoke<{ success: boolean }>('send_mail_message', {
    account,
    payload
  });
}
