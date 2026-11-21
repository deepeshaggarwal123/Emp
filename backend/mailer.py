"""Email (SMTP, e.g. MailHog on :1025) and Google Chat webhook helpers.
If SMTP is unreachable, the email is written to backend/outbox/ so demos still work."""
import json, os, smtplib, time, urllib.request
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

BASE = os.path.abspath(os.path.dirname(__file__))
OUTBOX = os.path.join(BASE, "outbox")


def send_email(to, subject, html):
    msg = MIMEMultipart("alternative")
    msg["Subject"], msg["To"] = subject, to
    msg["From"] = os.getenv("MAIL_FROM", "emp@localhost")
    msg.attach(MIMEText(html, "html"))
    try:
        with smtplib.SMTP(os.getenv("MAIL_HOST", "localhost"), int(os.getenv("MAIL_PORT", "1025")), timeout=3) as s:
            s.send_message(msg)
        return "smtp"
    except Exception:
        os.makedirs(OUTBOX, exist_ok=True)
        path = os.path.join(OUTBOX, f"{int(time.time()*1000)}_{to.replace('@','_at_')}.html")
        with open(path, "w", encoding="utf-8") as f:
            f.write(f"<!-- To: {to} | Subject: {subject} -->\n{html}")
        return "outbox"


def send_gchat(text):
    url = os.getenv("GCHAT_WEBHOOK")
    if not url:
        return False
    try:
        req = urllib.request.Request(url, data=json.dumps({"text": text}).encode(),
                                     headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=5)
        return True
    except Exception:
        return False
