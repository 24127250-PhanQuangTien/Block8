const nodemailer = require("nodemailer");

let transportPromise;

async function getTransport() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }

  transportPromise ||= nodemailer.createTestAccount().then((account) =>
    nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: { user: account.user, pass: account.pass },
    }),
  );
  return transportPromise;
}

async function sendMail({ to, subject, text, html }) {
  const transport = await getTransport();
  const info = await transport.sendMail({
    from: process.env.SMTP_FROM || "Restaurant App <no-reply@example.test>",
    to,
    subject,
    text,
    html,
  });
  if (!process.env.SMTP_HOST) {
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) console.log("Ethereal email preview:", previewUrl);
  }
}

function sendMailInBackground(message) {
  void sendMail(message).catch((error) => {
    console.error("Email delivery failed.", { name: error.name, code: error.code });
  });
}

module.exports = { sendMail, sendMailInBackground };
