use async_imap::{Client, Session};
use base64::Engine as _;
use futures::TryStreamExt;
use mail_parser::{Addr, Address, Message, MessageParser, MimeHeaders, PartType};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};

const MAIL_FETCH_TIMEOUT_MS: u64 = 45_000;
const MAIL_SEND_TIMEOUT_MS: u64 = 45_000;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailAccountConfig {
    auth_code: Option<String>,
    email: Option<String>,
    imap_host: Option<String>,
    imap_port: Option<u16>,
    secure: Option<bool>,
    username: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailSendPayload {
    attachments: Option<Vec<MailSendAttachmentPayload>>,
    cc: Option<Vec<String>>,
    html: Option<String>,
    subject: Option<String>,
    text: Option<String>,
    to: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailSendAttachmentPayload {
    content_base64: String,
    content_type: Option<String>,
    filename: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailFetchOptions {
    folder: Option<String>,
    limit: Option<u32>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailAttachmentDownloadRequest {
    folder: Option<String>,
    filename: Option<String>,
    index: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailFolderSummary {
    kind: String,
    name: String,
    path: String,
    total: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailAttachmentSummary {
    content_type: String,
    filename: String,
    index: usize,
    size: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailMessageSummary {
    attachments: Vec<MailAttachmentSummary>,
    date: String,
    flags: Vec<String>,
    from: String,
    folder: String,
    html: String,
    id: String,
    seen: bool,
    subject: String,
    text: String,
    to: String,
    uid: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailFetchResult {
    messages: Vec<MailMessageSummary>,
    total: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailAttachmentDownloadResult {
    filename: String,
    path: String,
    size: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailMutationResult {
    success: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailSendResult {
    success: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailSeenMutationResult {
    seen: bool,
    success: bool,
}

#[derive(Clone, Debug)]
struct NormalizedMailAccount {
    account_key: String,
    email: String,
    host: String,
    password: String,
    port: u16,
    secure: bool,
    username: String,
}

fn normalize_account(account: &MailAccountConfig) -> Result<NormalizedMailAccount, String> {
    let host = account
        .imap_host
        .clone()
        .unwrap_or_default()
        .trim()
        .to_string();
    let username = account
        .username
        .clone()
        .or_else(|| account.email.clone())
        .unwrap_or_default()
        .trim()
        .to_string();
    let password = account.auth_code.clone().unwrap_or_default();
    let port = account.imap_port.unwrap_or(993);

    if host.is_empty() {
        return Err("缺少 IMAP 服务器".to_string());
    }

    if username.is_empty() {
        return Err("缺少登录账号".to_string());
    }

    if password.is_empty() {
        return Err("缺少授权码或客户端密码".to_string());
    }

    Ok(NormalizedMailAccount {
        account_key: account
            .email
            .clone()
            .or_else(|| account.username.clone())
            .unwrap_or_else(|| "mail".to_string())
            .trim()
            .to_string(),
        email: account
            .email
            .clone()
            .unwrap_or_else(|| username.clone())
            .trim()
            .to_string(),
        host,
        password,
        port,
        secure: account.secure.unwrap_or(port == 993),
        username,
    })
}

fn normalize_folder(value: Option<&str>) -> String {
    let folder = value.unwrap_or("INBOX").trim();

    if folder.is_empty() {
        "INBOX".to_string()
    } else {
        folder.to_string()
    }
}

fn infer_folder_kind(path: &str, name: &str) -> String {
    let value = format!("{path}\n{name}").to_lowercase();

    if value.contains("inbox") || value.contains("收件") {
        "inbox"
    } else if value.contains("sent") || value.contains("已发送") || value.contains("发件") {
        "sent"
    } else if value.contains("draft") || value.contains("草稿") {
        "drafts"
    } else if value.contains("trash")
        || value.contains("deleted")
        || value.contains("已删除")
        || value.contains("垃圾箱")
    {
        "trash"
    } else if value.contains("junk") || value.contains("spam") || value.contains("垃圾邮件") {
        "junk"
    } else {
        "folder"
    }
    .to_string()
}

#[derive(Clone, Debug)]
struct SmtpConfig {
    host: String,
    port: u16,
    secure: bool,
    starttls: bool,
}

fn infer_smtp_config(
    account: &MailAccountConfig,
    normalized: &NormalizedMailAccount,
) -> SmtpConfig {
    let email = account
        .email
        .as_deref()
        .unwrap_or(normalized.username.as_str())
        .trim()
        .to_lowercase();

    if email.ends_with("@qq.com") || email.ends_with("@foxmail.com") {
        return SmtpConfig {
            host: "smtp.qq.com".to_string(),
            port: 465,
            secure: true,
            starttls: false,
        };
    }

    if email.ends_with("@139.com") {
        return SmtpConfig {
            host: "smtp.139.com".to_string(),
            port: 465,
            secure: true,
            starttls: false,
        };
    }

    if email.ends_with("@163.com") || email.ends_with("@126.com") {
        return SmtpConfig {
            host: "smtp.163.com".to_string(),
            port: 465,
            secure: true,
            starttls: false,
        };
    }

    let host = if normalized.host.starts_with("imap.") {
        normalized.host.replacen("imap.", "smtp.", 1)
    } else if let Some(domain) = normalized.host.strip_prefix("mail.") {
        format!("smtp.{domain}")
    } else {
        normalized.host.clone()
    };

    SmtpConfig {
        host,
        port: 465,
        secure: true,
        starttls: false,
    }
}

fn get_readable_mail_error(error: String, account: &MailAccountConfig) -> String {
    let host = account.imap_host.clone().unwrap_or_default();
    let account_text = account
        .email
        .clone()
        .or_else(|| account.username.clone())
        .unwrap_or_default();
    let is_139 = host.ends_with("139.com") || account_text.ends_with("@139.com");

    if is_139 {
        if error.contains("AUTH") || error.contains("LOGIN") || error.contains("password") {
            return "139 邮箱登录失败，请确认已在网页端开启 POP3/IMAP 服务，并使用 139 邮箱授权码或客户端密码。".to_string();
        }

        if error.contains("certificate") || error.contains("tls") || error.contains("SSL") {
            return "139 邮箱 SSL 证书校验失败，请确认服务器为 imap.139.com，端口为 993，并开启 SSL/TLS。".to_string();
        }

        if error.contains("timed out")
            || error.contains("refused")
            || error.contains("reset")
            || error.contains("dns")
        {
            return "139 邮箱连接失败，请检查网络，或确认服务器 imap.139.com 与 993 端口可访问。"
                .to_string();
        }
    }

    error
}

fn flag_to_string(flag: async_imap::types::Flag<'_>) -> String {
    match flag {
        async_imap::types::Flag::Seen => "\\Seen".to_string(),
        async_imap::types::Flag::Answered => "\\Answered".to_string(),
        async_imap::types::Flag::Flagged => "\\Flagged".to_string(),
        async_imap::types::Flag::Deleted => "\\Deleted".to_string(),
        async_imap::types::Flag::Draft => "\\Draft".to_string(),
        async_imap::types::Flag::Recent => "\\Recent".to_string(),
        async_imap::types::Flag::MayCreate => "\\*".to_string(),
        async_imap::types::Flag::Custom(value) => value.to_string(),
    }
}

fn format_addr(addr: &Addr<'_>) -> String {
    let name = addr.name.as_deref().unwrap_or("").trim();
    let address = addr.address.as_deref().unwrap_or("").trim();

    if name.is_empty() {
        address.to_string()
    } else if address.is_empty() {
        name.to_string()
    } else {
        format!("{name} <{address}>")
    }
}

fn format_address(value: Option<&Address<'_>>) -> String {
    match value {
        Some(Address::List(items)) => items
            .iter()
            .map(format_addr)
            .filter(|item| !item.is_empty())
            .collect::<Vec<_>>()
            .join(", "),
        Some(Address::Group(groups)) => groups
            .iter()
            .flat_map(|group| group.addresses.iter())
            .map(format_addr)
            .filter(|item| !item.is_empty())
            .collect::<Vec<_>>()
            .join(", "),
        None => String::new(),
    }
}

fn part_size(part: &mail_parser::MessagePart<'_>) -> usize {
    match &part.body {
        PartType::Text(value) | PartType::Html(value) => value.len(),
        PartType::Binary(value) | PartType::InlineBinary(value) => value.len(),
        PartType::Message(message) => message.raw_message.len(),
        PartType::Multipart(_) => 0,
    }
}

fn part_bytes(part: &mail_parser::MessagePart<'_>) -> Option<Vec<u8>> {
    match &part.body {
        PartType::Text(value) | PartType::Html(value) => Some(value.as_bytes().to_vec()),
        PartType::Binary(value) | PartType::InlineBinary(value) => Some(value.to_vec()),
        _ => None,
    }
}

fn content_type(part: &mail_parser::MessagePart<'_>) -> String {
    part.content_type()
        .map(|value| {
            let subtype = value.subtype().unwrap_or("");

            if subtype.is_empty() {
                value.ctype().to_string()
            } else {
                format!("{}/{}", value.ctype(), subtype)
            }
        })
        .unwrap_or_default()
}

fn parse_message_body(raw: &[u8]) -> Option<Message<'_>> {
    MessageParser::default().parse(raw)
}

fn envelope_subject(fetch: &async_imap::types::Fetch) -> Option<String> {
    fetch.envelope().and_then(|envelope| {
        envelope
            .subject
            .as_ref()
            .map(|value| String::from_utf8_lossy(value).into_owned())
    })
}

fn normalize_message(
    account: &NormalizedMailAccount,
    fetch: &async_imap::types::Fetch,
) -> MailMessageSummary {
    let uid = fetch.uid.unwrap_or(fetch.message);
    let flags = fetch.flags().map(flag_to_string).collect::<Vec<_>>();
    let parsed = fetch.body().and_then(parse_message_body);
    let parsed_ref = parsed.as_ref();
    let date = fetch
        .internal_date()
        .map(|value| value.to_rfc3339())
        .or_else(|| parsed_ref.and_then(|message| message.date().map(|date| date.to_rfc3339())))
        .unwrap_or_else(chrono_like_now);
    let attachments = parsed
        .as_ref()
        .map(|message| {
            message
                .attachments()
                .enumerate()
                .map(|(index, part)| MailAttachmentSummary {
                    content_type: content_type(part),
                    filename: part.attachment_name().unwrap_or("未命名附件").to_string(),
                    index,
                    size: part_size(part),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let html = parsed
        .as_ref()
        .and_then(|message| message.body_html(0).map(|value| value.into_owned()))
        .unwrap_or_default();
    let text = parsed
        .as_ref()
        .and_then(|message| message.body_text(0).map(|value| value.into_owned()))
        .unwrap_or_default();
    let subject = parsed
        .as_ref()
        .and_then(|message| message.subject().map(str::to_string))
        .or_else(|| envelope_subject(fetch))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "(无主题)".to_string());
    let from = parsed
        .as_ref()
        .map(|message| format_address(message.from()))
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    let to = parsed
        .as_ref()
        .map(|message| format_address(message.to()))
        .filter(|value| !value.is_empty())
        .unwrap_or_default();

    MailMessageSummary {
        attachments,
        date,
        flags: flags.clone(),
        from,
        folder: "INBOX".to_string(),
        html,
        id: format!("{}:{uid}", account.account_key),
        seen: flags.iter().any(|flag| flag.eq_ignore_ascii_case("\\Seen")),
        subject,
        text,
        to,
        uid,
    }
}

async fn list_folders_with_session<T>(
    mut session: Session<T>,
) -> Result<Vec<MailFolderSummary>, String>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + std::fmt::Debug,
    T: Send,
{
    let folders = session
        .list(None, Some("*"))
        .await
        .map_err(|error| error.to_string())?
        .try_collect::<Vec<_>>()
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|folder| {
            let path = folder.name().to_string();
            let name = path
                .rsplit(['/', '.'])
                .next()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(path.as_str())
                .to_string();

            MailFolderSummary {
                kind: infer_folder_kind(&path, &name),
                name,
                path,
                total: 0,
            }
        })
        .collect::<Vec<_>>();
    let _ = session.logout().await;

    Ok(folders)
}

fn chrono_like_now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn sanitize_filename(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|item| {
            if item.is_control()
                || matches!(item, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
            {
                '_'
            } else {
                item
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .chars()
        .take(180)
        .collect::<String>();

    if sanitized.is_empty() {
        "未命名附件".to_string()
    } else {
        sanitized
    }
}

fn encode_header(value: &str) -> String {
    if value.is_ascii() {
        value.to_string()
    } else {
        format!(
            "=?UTF-8?B?{}?=",
            base64::engine::general_purpose::STANDARD.encode(value.as_bytes())
        )
    }
}

fn extract_email(value: &str) -> String {
    let text = value.trim();
    if let Some(start) = text.find('<') {
        if let Some(end) = text[start + 1..].find('>') {
            return text[start + 1..start + 1 + end].trim().to_string();
        }
    }

    text.to_string()
}

fn sanitize_mailbox(value: &str) -> Result<String, String> {
    let address = extract_email(value);

    if address.contains('@')
        && !address.contains(['\r', '\n'])
        && !address.starts_with('<')
        && !address.ends_with('>')
    {
        Ok(address)
    } else {
        Err(format!("邮箱地址无效：{value}"))
    }
}

fn dot_stuff(value: &str) -> String {
    value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(|line| {
            if line.starts_with('.') {
                format!(".{line}")
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\r\n")
}

fn sanitize_mime_token(value: &str) -> String {
    value
        .chars()
        .filter(|item| !matches!(item, '\r' | '\n' | '"' | '\\'))
        .collect::<String>()
        .trim()
        .to_string()
}

fn base64_lines(value: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD
        .encode(value)
        .as_bytes()
        .chunks(76)
        .map(|chunk| String::from_utf8_lossy(chunk).to_string())
        .collect::<Vec<_>>()
        .join("\r\n")
}

fn mime_text_part(content_type: &str, content: &str) -> String {
    format!(
        "Content-Type: {content_type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n{}",
        base64_lines(content.as_bytes())
    )
}

fn mime_attachment_part(attachment: &MailSendAttachmentPayload) -> Result<String, String> {
    let filename = sanitize_mime_token(&attachment.filename);

    if filename.is_empty() {
        return Err("附件文件名不能为空".to_string());
    }

    let content_type = sanitize_mime_token(
        attachment
            .content_type
            .as_deref()
            .unwrap_or("application/octet-stream"),
    );
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(attachment.content_base64.trim())
        .map_err(|_| format!("附件 {filename} 内容不是有效 base64"))?;

    Ok(format!(
        "Content-Type: {}; name=\"{}\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"{}\"\r\n\r\n{}",
        if content_type.is_empty() { "application/octet-stream" } else { &content_type },
        filename,
        filename,
        base64_lines(&bytes)
    ))
}

fn build_mail_message(
    normalized: &NormalizedMailAccount,
    payload: &MailSendPayload,
) -> Result<(String, Vec<String>), String> {
    let to = payload
        .to
        .iter()
        .map(|item| sanitize_mailbox(item))
        .collect::<Result<Vec<_>, _>>()?;
    let cc = payload
        .cc
        .clone()
        .unwrap_or_default()
        .iter()
        .filter(|item| !item.trim().is_empty())
        .map(|item| sanitize_mailbox(item))
        .collect::<Result<Vec<_>, _>>()?;

    if to.is_empty() {
        return Err("请填写收件人".to_string());
    }

    let subject = encode_header(payload.subject.as_deref().unwrap_or("(无主题)").trim());
    let text = payload.text.as_deref().unwrap_or("").trim();
    let html = payload.html.as_deref().unwrap_or("").trim();
    let from = sanitize_mailbox(&normalized.email)?;
    let mut recipients = to.clone();
    recipients.extend(cc.clone());

    let text_part = if !html.is_empty() {
        mime_text_part("text/html", html)
    } else {
        mime_text_part("text/plain", text)
    };
    let attachments = payload.attachments.clone().unwrap_or_default();
    let body = if attachments.is_empty() {
        text_part
    } else {
        let boundary = format!(
            "tooldesk-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        );
        let mut parts = vec![text_part];

        for attachment in &attachments {
            parts.push(mime_attachment_part(attachment)?);
        }

        format!(
            "Content-Type: multipart/mixed; boundary=\"{boundary}\"\r\n\r\n{}--{boundary}--",
            parts
                .into_iter()
                .map(|part| format!("--{boundary}\r\n{part}\r\n"))
                .collect::<String>()
        )
    };

    let mut headers = vec![
        format!("From: <{from}>"),
        format!("To: {}", to.join(", ")),
        format!("Subject: {subject}"),
        "MIME-Version: 1.0".to_string(),
        format!("Date: {}", chrono::Utc::now().to_rfc2822()),
    ];

    if !cc.is_empty() {
        headers.push(format!("Cc: {}", cc.join(", ")));
    }

    headers.push(body);

    Ok((headers.join("\r\n"), recipients))
}

async fn smtp_read_response<T>(reader: &mut BufReader<T>) -> Result<String, String>
where
    T: AsyncRead + Unpin,
{
    let mut response = String::new();

    loop {
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .await
            .map_err(|error| error.to_string())?;

        if read == 0 {
            return Err("SMTP 连接已关闭".to_string());
        }

        let done = line.as_bytes().get(3) == Some(&b' ');
        response.push_str(&line);

        if done {
            break;
        }
    }

    Ok(response)
}

fn smtp_response_ok(response: &str, codes: &[&str]) -> bool {
    codes.iter().any(|code| response.starts_with(code))
}

async fn smtp_command<T>(
    reader: &mut BufReader<T>,
    command: &str,
    expected: &[&str],
) -> Result<String, String>
where
    T: AsyncRead + AsyncWrite + Unpin,
{
    reader
        .get_mut()
        .write_all(command.as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    reader
        .get_mut()
        .flush()
        .await
        .map_err(|error| error.to_string())?;
    let response = smtp_read_response(reader).await?;

    if smtp_response_ok(&response, expected) {
        Ok(response)
    } else {
        Err(response.trim().to_string())
    }
}

async fn smtp_login_and_send<T>(
    stream: T,
    config: &SmtpConfig,
    normalized: &NormalizedMailAccount,
    payload: &MailSendPayload,
) -> Result<MailSendResult, String>
where
    T: AsyncRead + AsyncWrite + Unpin,
{
    let mut reader = BufReader::new(stream);
    let greeting = smtp_read_response(&mut reader).await?;

    if !smtp_response_ok(&greeting, &["220"]) {
        return Err(greeting.trim().to_string());
    }

    smtp_command(&mut reader, "EHLO tooldesk.local\r\n", &["250"]).await?;

    if config.starttls {
        smtp_command(&mut reader, "STARTTLS\r\n", &["220"]).await?;
        return Err("当前 SMTP STARTTLS 升级失败，请改用 465 SSL/TLS。".to_string());
    }

    smtp_command(&mut reader, "AUTH LOGIN\r\n", &["334"]).await?;
    smtp_command(
        &mut reader,
        &format!(
            "{}\r\n",
            base64::engine::general_purpose::STANDARD.encode(normalized.username.as_bytes())
        ),
        &["334"],
    )
    .await?;
    smtp_command(
        &mut reader,
        &format!(
            "{}\r\n",
            base64::engine::general_purpose::STANDARD.encode(normalized.password.as_bytes())
        ),
        &["235"],
    )
    .await?;

    let from = sanitize_mailbox(&normalized.email)?;
    let (message, recipients) = build_mail_message(normalized, payload)?;
    smtp_command(&mut reader, &format!("MAIL FROM:<{from}>\r\n"), &["250"]).await?;

    for recipient in recipients {
        smtp_command(
            &mut reader,
            &format!("RCPT TO:<{recipient}>\r\n"),
            &["250", "251"],
        )
        .await?;
    }

    smtp_command(&mut reader, "DATA\r\n", &["354"]).await?;
    smtp_command(
        &mut reader,
        &format!("{}\r\n.\r\n", dot_stuff(&message)),
        &["250"],
    )
    .await?;
    let _ = smtp_command(&mut reader, "QUIT\r\n", &["221"]).await;

    Ok(MailSendResult { success: true })
}

fn downloads_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .unwrap_or_else(std::env::temp_dir)
        .join("Downloads")
}

fn unique_download_path(filename: &str) -> Result<PathBuf, String> {
    let download_dir = downloads_dir();
    fs::create_dir_all(&download_dir).map_err(|error| error.to_string())?;
    let safe_name = sanitize_filename(filename);
    let parsed = Path::new(&safe_name);
    let stem = parsed
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("未命名附件");
    let ext = parsed
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");

    for index in 0..10_000 {
        let filename = if index == 0 {
            safe_name.clone()
        } else if ext.is_empty() {
            format!("{stem} ({index})")
        } else {
            format!("{stem} ({index}).{ext}")
        };
        let candidate = download_dir.join(filename);

        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("无法生成唯一附件文件名".to_string())
}

async fn fetch_with_session<T>(
    mut session: Session<T>,
    account: &NormalizedMailAccount,
    folder: &str,
    limit: u32,
) -> Result<MailFetchResult, String>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + std::fmt::Debug,
    T: Send,
{
    let mailbox = session
        .examine(folder)
        .await
        .map_err(|error| error.to_string())?;
    let total = mailbox.exists;
    let mut messages = Vec::new();

    if total > 0 {
        let start = total.saturating_sub(limit).saturating_add(1).max(1);
        let range = format!("{start}:*");
        let query = "(UID FLAGS INTERNALDATE ENVELOPE BODY.PEEK[])";
        let fetched = session
            .fetch(range, query)
            .await
            .map_err(|error| error.to_string())?
            .try_collect::<Vec<_>>()
            .await
            .map_err(|error| error.to_string())?;

        messages = fetched
            .iter()
            .map(|fetch| {
                let mut message = normalize_message(account, fetch);
                message.folder = folder.to_string();
                message
            })
            .collect::<Vec<_>>();
        messages.sort_by_key(|message| std::cmp::Reverse(message.uid));
    }

    let _ = session.logout().await;

    Ok(MailFetchResult { messages, total })
}

async fn download_with_session<T>(
    mut session: Session<T>,
    folder: &str,
    uid: u64,
    attachment: MailAttachmentDownloadRequest,
) -> Result<MailAttachmentDownloadResult, String>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + std::fmt::Debug,
    T: Send,
{
    session
        .examine(folder)
        .await
        .map_err(|error| error.to_string())?;
    let fetched = session
        .uid_fetch(uid.to_string(), "(BODY.PEEK[])")
        .await
        .map_err(|error| error.to_string())?
        .try_collect::<Vec<_>>()
        .await
        .map_err(|error| error.to_string())?;
    let raw = fetched
        .first()
        .and_then(|item| item.body())
        .ok_or_else(|| "未找到邮件正文".to_string())?;
    let parsed = parse_message_body(raw).ok_or_else(|| "邮件解析失败".to_string())?;
    let index = attachment.index.unwrap_or(0);
    let part = parsed
        .attachments()
        .nth(index)
        .ok_or_else(|| "未找到附件".to_string())?;
    let filename = sanitize_filename(
        attachment
            .filename
            .as_deref()
            .or_else(|| part.attachment_name())
            .unwrap_or("未命名附件"),
    );
    let bytes = part_bytes(part).ok_or_else(|| "附件内容为空".to_string())?;
    let target = unique_download_path(&filename)?;

    fs::write(&target, &bytes).map_err(|error| error.to_string())?;
    let _ = session.logout().await;

    Ok(MailAttachmentDownloadResult {
        filename,
        path: target.to_string_lossy().to_string(),
        size: bytes.len(),
    })
}

async fn set_seen_with_session<T>(
    mut session: Session<T>,
    folder: &str,
    uid: u64,
    seen: bool,
) -> Result<MailSeenMutationResult, String>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + std::fmt::Debug,
    T: Send,
{
    session
        .select(folder)
        .await
        .map_err(|error| error.to_string())?;
    let query = if seen {
        "+FLAGS.SILENT (\\Seen)"
    } else {
        "-FLAGS.SILENT (\\Seen)"
    };
    session
        .uid_store(uid.to_string(), query)
        .await
        .map_err(|error| error.to_string())?
        .try_collect::<Vec<_>>()
        .await
        .map_err(|error| error.to_string())?;
    let _ = session.logout().await;

    Ok(MailSeenMutationResult {
        seen,
        success: true,
    })
}

async fn delete_with_session<T>(
    mut session: Session<T>,
    folder: &str,
    uid: u64,
) -> Result<MailMutationResult, String>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + std::fmt::Debug,
    T: Send,
{
    session
        .select(folder)
        .await
        .map_err(|error| error.to_string())?;
    session
        .uid_store(uid.to_string(), "+FLAGS.SILENT (\\Deleted)")
        .await
        .map_err(|error| error.to_string())?
        .try_collect::<Vec<_>>()
        .await
        .map_err(|error| error.to_string())?;
    session
        .uid_expunge(uid.to_string())
        .await
        .map_err(|error| error.to_string())?
        .try_collect::<Vec<_>>()
        .await
        .map_err(|error| error.to_string())?;
    let _ = session.logout().await;

    Ok(MailMutationResult { success: true })
}

async fn fetch_mail_messages_inner(
    account: MailAccountConfig,
    options: MailFetchOptions,
) -> Result<MailFetchResult, String> {
    let normalized = normalize_account(&account)?;
    let folder = normalize_folder(options.folder.as_deref());
    let limit = options.limit.unwrap_or(20).clamp(1, 50);
    let address = format!("{}:{}", normalized.host, normalized.port);
    let tcp = TcpStream::connect(address)
        .await
        .map_err(|error| error.to_string())?;

    if normalized.secure {
        let tls = async_native_tls::connect(normalized.host.as_str(), tcp)
            .await
            .map_err(|error| error.to_string())?;
        let mut client = Client::new(tls);
        let _ = client
            .read_response()
            .await
            .map_err(|error| error.to_string())?;
        let session = client
            .login(&normalized.username, &normalized.password)
            .await
            .map_err(|(error, _client)| error.to_string())?;
        fetch_with_session(session, &normalized, &folder, limit).await
    } else {
        let mut client = Client::new(tcp);
        let _ = client
            .read_response()
            .await
            .map_err(|error| error.to_string())?;
        let session = client
            .login(&normalized.username, &normalized.password)
            .await
            .map_err(|(error, _client)| error.to_string())?;
        fetch_with_session(session, &normalized, &folder, limit).await
    }
}

async fn list_mail_folders_inner(
    account: MailAccountConfig,
) -> Result<Vec<MailFolderSummary>, String> {
    let normalized = normalize_account(&account)?;
    let address = format!("{}:{}", normalized.host, normalized.port);
    let tcp = TcpStream::connect(address)
        .await
        .map_err(|error| error.to_string())?;

    if normalized.secure {
        let tls = async_native_tls::connect(normalized.host.as_str(), tcp)
            .await
            .map_err(|error| error.to_string())?;
        let mut client = Client::new(tls);
        let _ = client
            .read_response()
            .await
            .map_err(|error| error.to_string())?;
        let session = client
            .login(&normalized.username, &normalized.password)
            .await
            .map_err(|(error, _client)| error.to_string())?;
        list_folders_with_session(session).await
    } else {
        let mut client = Client::new(tcp);
        let _ = client
            .read_response()
            .await
            .map_err(|error| error.to_string())?;
        let session = client
            .login(&normalized.username, &normalized.password)
            .await
            .map_err(|(error, _client)| error.to_string())?;
        list_folders_with_session(session).await
    }
}

async fn download_mail_attachment_inner(
    account: MailAccountConfig,
    message: serde_json::Value,
    attachment: MailAttachmentDownloadRequest,
) -> Result<MailAttachmentDownloadResult, String> {
    let normalized = normalize_account(&account)?;
    let folder = normalize_folder(
        attachment
            .folder
            .as_deref()
            .or_else(|| message.get("folder").and_then(|value| value.as_str())),
    );
    let uid = message
        .get("uid")
        .and_then(|value| value.as_u64())
        .ok_or_else(|| "缺少邮件 UID".to_string())?;
    let address = format!("{}:{}", normalized.host, normalized.port);
    let tcp = TcpStream::connect(address)
        .await
        .map_err(|error| error.to_string())?;

    if normalized.secure {
        let tls = async_native_tls::connect(normalized.host.as_str(), tcp)
            .await
            .map_err(|error| error.to_string())?;
        let mut client = Client::new(tls);
        let _ = client
            .read_response()
            .await
            .map_err(|error| error.to_string())?;
        let session = client
            .login(&normalized.username, &normalized.password)
            .await
            .map_err(|(error, _client)| error.to_string())?;
        download_with_session(session, &folder, uid, attachment).await
    } else {
        let mut client = Client::new(tcp);
        let _ = client
            .read_response()
            .await
            .map_err(|error| error.to_string())?;
        let session = client
            .login(&normalized.username, &normalized.password)
            .await
            .map_err(|(error, _client)| error.to_string())?;
        download_with_session(session, &folder, uid, attachment).await
    }
}

async fn set_mail_message_seen_inner(
    account: MailAccountConfig,
    message: serde_json::Value,
    seen: bool,
) -> Result<MailSeenMutationResult, String> {
    let normalized = normalize_account(&account)?;
    let folder = normalize_folder(message.get("folder").and_then(|value| value.as_str()));
    let uid = message
        .get("uid")
        .and_then(|value| value.as_u64())
        .ok_or_else(|| "缺少邮件 UID".to_string())?;
    let address = format!("{}:{}", normalized.host, normalized.port);
    let tcp = TcpStream::connect(address)
        .await
        .map_err(|error| error.to_string())?;

    if normalized.secure {
        let tls = async_native_tls::connect(normalized.host.as_str(), tcp)
            .await
            .map_err(|error| error.to_string())?;
        let mut client = Client::new(tls);
        let _ = client
            .read_response()
            .await
            .map_err(|error| error.to_string())?;
        let session = client
            .login(&normalized.username, &normalized.password)
            .await
            .map_err(|(error, _client)| error.to_string())?;
        set_seen_with_session(session, &folder, uid, seen).await
    } else {
        let mut client = Client::new(tcp);
        let _ = client
            .read_response()
            .await
            .map_err(|error| error.to_string())?;
        let session = client
            .login(&normalized.username, &normalized.password)
            .await
            .map_err(|(error, _client)| error.to_string())?;
        set_seen_with_session(session, &folder, uid, seen).await
    }
}

async fn delete_mail_message_inner(
    account: MailAccountConfig,
    message: serde_json::Value,
) -> Result<MailMutationResult, String> {
    let normalized = normalize_account(&account)?;
    let folder = normalize_folder(message.get("folder").and_then(|value| value.as_str()));
    let uid = message
        .get("uid")
        .and_then(|value| value.as_u64())
        .ok_or_else(|| "缺少邮件 UID".to_string())?;
    let address = format!("{}:{}", normalized.host, normalized.port);
    let tcp = TcpStream::connect(address)
        .await
        .map_err(|error| error.to_string())?;

    if normalized.secure {
        let tls = async_native_tls::connect(normalized.host.as_str(), tcp)
            .await
            .map_err(|error| error.to_string())?;
        let mut client = Client::new(tls);
        let _ = client
            .read_response()
            .await
            .map_err(|error| error.to_string())?;
        let session = client
            .login(&normalized.username, &normalized.password)
            .await
            .map_err(|(error, _client)| error.to_string())?;
        delete_with_session(session, &folder, uid).await
    } else {
        let mut client = Client::new(tcp);
        let _ = client
            .read_response()
            .await
            .map_err(|error| error.to_string())?;
        let session = client
            .login(&normalized.username, &normalized.password)
            .await
            .map_err(|(error, _client)| error.to_string())?;
        delete_with_session(session, &folder, uid).await
    }
}

async fn send_mail_message_inner(
    account: MailAccountConfig,
    payload: MailSendPayload,
) -> Result<MailSendResult, String> {
    let normalized = normalize_account(&account)?;
    let config = infer_smtp_config(&account, &normalized);
    let address = format!("{}:{}", config.host, config.port);
    let tcp = TcpStream::connect(address)
        .await
        .map_err(|error| error.to_string())?;

    if config.secure {
        let tls = async_native_tls::connect(config.host.as_str(), tcp)
            .await
            .map_err(|error| error.to_string())?;
        smtp_login_and_send(tls, &config, &normalized, &payload).await
    } else {
        smtp_login_and_send(tcp, &config, &normalized, &payload).await
    }
}

#[tauri::command]
pub(crate) async fn fetch_mail_messages(
    account: MailAccountConfig,
    options: Option<MailFetchOptions>,
) -> Result<MailFetchResult, String> {
    let account_for_error = account.clone();
    let result = timeout(
        Duration::from_millis(MAIL_FETCH_TIMEOUT_MS),
        fetch_mail_messages_inner(
            account,
            options.unwrap_or(MailFetchOptions {
                folder: None,
                limit: None,
            }),
        ),
    )
    .await
    .map_err(|_| "邮件收取超时，请检查 IMAP 服务器和网络。".to_string())?;

    result.map_err(|error| get_readable_mail_error(error, &account_for_error))
}

#[tauri::command]
pub(crate) async fn list_mail_folders(
    account: MailAccountConfig,
) -> Result<Vec<MailFolderSummary>, String> {
    let account_for_error = account.clone();
    let result = timeout(
        Duration::from_millis(MAIL_FETCH_TIMEOUT_MS),
        list_mail_folders_inner(account),
    )
    .await
    .map_err(|_| "邮箱文件夹读取超时，请检查 IMAP 服务器和网络。".to_string())?;

    result.map_err(|error| get_readable_mail_error(error, &account_for_error))
}

#[tauri::command]
pub(crate) async fn download_mail_attachment(
    account: MailAccountConfig,
    message: serde_json::Value,
    attachment: MailAttachmentDownloadRequest,
) -> Result<MailAttachmentDownloadResult, String> {
    let account_for_error = account.clone();
    let result = timeout(
        Duration::from_millis(MAIL_FETCH_TIMEOUT_MS),
        download_mail_attachment_inner(account, message, attachment),
    )
    .await
    .map_err(|_| "附件下载超时，请检查 IMAP 服务器和网络。".to_string())?;

    result.map_err(|error| get_readable_mail_error(error, &account_for_error))
}

#[tauri::command]
pub(crate) async fn set_mail_message_seen(
    account: MailAccountConfig,
    message: serde_json::Value,
    seen: bool,
) -> Result<MailSeenMutationResult, String> {
    let account_for_error = account.clone();
    let result = timeout(
        Duration::from_millis(MAIL_FETCH_TIMEOUT_MS),
        set_mail_message_seen_inner(account, message, seen),
    )
    .await
    .map_err(|_| "邮件状态更新超时，请检查 IMAP 服务器和网络。".to_string())?;

    result.map_err(|error| get_readable_mail_error(error, &account_for_error))
}

#[tauri::command]
pub(crate) async fn delete_mail_message(
    account: MailAccountConfig,
    message: serde_json::Value,
) -> Result<MailMutationResult, String> {
    let account_for_error = account.clone();
    let result = timeout(
        Duration::from_millis(MAIL_FETCH_TIMEOUT_MS),
        delete_mail_message_inner(account, message),
    )
    .await
    .map_err(|_| "邮件删除超时，请检查 IMAP 服务器和网络。".to_string())?;

    result.map_err(|error| get_readable_mail_error(error, &account_for_error))
}

#[tauri::command]
pub(crate) async fn send_mail_message(
    account: MailAccountConfig,
    payload: MailSendPayload,
) -> Result<MailSendResult, String> {
    let account_for_error = account.clone();
    let result = timeout(
        Duration::from_millis(MAIL_SEND_TIMEOUT_MS),
        send_mail_message_inner(account, payload),
    )
    .await
    .map_err(|_| "邮件发送超时，请检查 SMTP 服务器和网络。".to_string())?;

    result.map_err(|error| get_readable_mail_error(error, &account_for_error))
}
