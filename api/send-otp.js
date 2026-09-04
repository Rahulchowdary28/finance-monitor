import { Resend } from 'resend';

const resendApiKey = process.env.RESEND_API_KEY || 're_12345';
const resend = new Resend(resendApiKey);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const { email, otpCode, name } = body;

  if (!email || !otpCode) {
    return res.status(400).json({ error: 'Email and OTP code are required.' });
  }

  const userName = name || email.split('@')[0];

  const htmlContent = `
  <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #040612; color: #94a3b8; padding: 35px 15px; text-align: center;">
    <div style="max-width: 440px; margin: 0 auto; background: #0b0f19; border: 1px solid #00f0ff44; border-radius: 18px; padding: 32px; box-shadow: 0 10px 30px rgba(0,240,255,0.15);">
      
      <div style="font-size: 22px; font-weight: 800; color: #00ff88; letter-spacing: 2px; margin-bottom: 4px;">
        ⚡ VIRTUAL VAULT
      </div>
      <div style="font-size: 10px; color: #64748b; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 24px;">
        SECURITY ACCESS AUTHORIZATION
      </div>

      <h3 style="color: #ffffff; font-size: 17px; margin: 0 0 10px 0; font-weight: 700;">
        Email Security OTP Code
      </h3>
      <p style="font-size: 13px; color: #94a3b8; line-height: 1.5; margin-bottom: 20px;">
        Greetings <strong>${userName}</strong>, enter the 6-digit verification code below to authorize your manual registration:
      </p>

      <div style="background: rgba(0, 240, 255, 0.08); border: 2px dashed #00f0ff; border-radius: 14px; padding: 20px; margin: 22px 0; text-align: center;">
        <span style="font-family: 'Courier New', monospace; font-size: 40px; font-weight: 900; letter-spacing: 12px; color: #00ff88;">${otpCode}</span>
      </div>

      <p style="font-size: 12px; color: #64748b; margin-top: 20px;">
        This 6-digit security pass expires in 10 minutes. If you did not request account creation, please ignore this email.
      </p>

      <div style="margin-top: 24px; padding: 12px; background: rgba(0, 240, 255, 0.05); border-left: 3px solid #00f0ff; border-radius: 4px; text-align: left; font-size: 11px; color: #94a3b8; line-height: 1.4;">
        <strong style="color: #00f0ff;">Notice:</strong> Do not share this 6-digit security code with anyone.
      </div>

    </div>

    <div style="margin-top: 22px; font-size: 10px; color: #475569;">
      Sent via Virtual Vault Security System • © 2026 Virtual Vault.
    </div>
  </div>
  `;

  try {
    const data = await resend.emails.send({
      from: 'Virtual Vault <onboarding@resend.dev>',
      to: [email],
      subject: `Your 6-Digit Security OTP Code: ${otpCode}`,
      html: htmlContent
    });

    return res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    console.error('Error sending OTP via Resend:', err);
    return res.status(500).json({ error: err.message || 'Failed to send OTP email.' });
  }
}
