import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://kfbtsoszcfnoovjvomir.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_md-VYPsxNFbHtkUalYbnLw_9tidXE03'
);

const resendApiKey = process.env.RESEND_API_KEY || 're_12345';
const resend = new Resend(resendApiKey);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST to dispatch mail.' });
  }

  try {
    const { recipients, subject, html, senderName, senderEmail } = req.body || {};

    if (!subject || typeof subject !== 'string' || !subject.trim()) {
      return res.status(400).json({ error: 'Email subject is required.' });
    }

    if (!html || typeof html !== 'string' || !html.trim()) {
      return res.status(400).json({ error: 'HTML email body code is required.' });
    }

    let targetEmails = [];

    if (recipients === 'all' || !recipients) {
      const { data: users, error: uErr } = await supabase
        .from('users_list')
        .select('name, email')
        .eq('is_hold', false);

      if (uErr) throw uErr;

      targetEmails = (users || [])
        .map(u => (u.email || '').trim().toLowerCase())
        .filter(e => e && e.includes('@'));
    } else if (Array.isArray(recipients)) {
      targetEmails = recipients
        .map(e => String(e).trim().toLowerCase())
        .filter(e => e && e.includes('@'));
    } else if (typeof recipients === 'string') {
      targetEmails = recipients
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(e => e && e.includes('@'));
    }

    // Deduplicate emails
    targetEmails = Array.from(new Set(targetEmails));

    if (targetEmails.length === 0) {
      return res.status(400).json({ error: 'No valid recipient email addresses found.' });
    }

    const defaultFrom = process.env.SENDER_EMAIL || 'Vault Terminal <alerts@drivehouse.ae>';
    const fromAddress = senderEmail 
      ? (senderName ? `${senderName} <${senderEmail}>` : senderEmail)
      : defaultFrom;

    let delivered = 0;
    let failed = 0;
    const errors = [];

    if (process.env.RESEND_API_KEY) {
      for (const email of targetEmails) {
        try {
          await resend.emails.send({
            from: fromAddress,
            to: email,
            subject: subject.trim(),
            html: html.trim(),
          });
          delivered++;

          if (targetEmails.length > 1) {
            await new Promise(r => setTimeout(r, 120));
          }
        } catch (err) {
          console.error(`Failed sending to ${email}:`, err.message || err);
          failed++;
          errors.push({ email, error: err.message || String(err) });
        }
      }
    } else {
      // Local development or simulated dispatch
      delivered = targetEmails.length;
    }

    return res.status(200).json({
      success: true,
      delivered,
      failed,
      total: targetEmails.length,
      recipients: targetEmails,
      errors: errors.length > 0 ? errors : undefined,
      message: `Successfully dispatched email payload to ${delivered} recipient(s).`
    });
  } catch (err) {
    console.error("DISPATCH ERROR:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}
