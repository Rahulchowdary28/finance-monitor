import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://kfbtsoszcfnoovjvomir.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_md-VYPsxNFbHtkUalYbnLw_9tidXE03'
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    const { title, message } = req.body || {};
    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required.' });
    }
    return handleBroadcast(req, res, title, message, false);
  }

  if (req.method === 'GET') {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
    const isVercelCron = req.headers['x-vercel-cron'] === '1';
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron) {
      return res.status(401).json({ error: 'Unauthorized security perimeter breach.' });
    }
    return handleBroadcast(req, res, '💸 Reminder', 'Spent Well?? Click here to Record it.', true);
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}

async function handleBroadcast(req, res, defaultTitle, defaultMessage, filterMissingExpenses = false) {
  try {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || 'BHaR2ys29miH921MBJ3so73X3LT8MDeYGiRS5l8f1sTD4x8rtQQcSR-CbvfxAjLFi607nQ_Xq239UHuiMX3xA3k';
    const privateKey = process.env.VAPID_PRIVATE_KEY;

    if (publicKey && privateKey) {
      try {
        webpush.setVapidDetails('mailto:alerts@drivehouse.ae', publicKey, privateKey);
      } catch (e) {
        console.warn("Webpush setup note:", e.message);
      }
    }

    const { data: users, error: userError } = await supabase
      .from('users_list')
      .select('name, push_subscription')
      .eq('is_hold', false)
      .not('push_subscription', 'is', null);

    if (userError) throw userError;

    let recipients = users || [];

    if (filterMissingExpenses) {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);

      const { data: todayTransactions } = await supabase
        .from('transactions')
        .select('user_name')
        .gte('created_at', startOfDay.toISOString());

      const activeUsersToday = new Set(
        (todayTransactions || []).map((t) => (t.user_name || '').toLowerCase())
      );

      recipients = recipients.filter(
        (u) => !activeUsersToday.has((u.name || '').toLowerCase())
      );
    }

    let delivered = 0;
    let failed = 0;

    if (privateKey && recipients.length > 0) {
      await Promise.all(
        recipients.map(async (user) => {
          if (!user.push_subscription) return;
          const payload = JSON.stringify({
            title: defaultTitle,
            body: `Hey ${user.name}! ${defaultMessage}`,
            message: `Hey ${user.name}! ${defaultMessage}`,
            icon: 'https://kfbtsoszcfnoovjvomir.supabase.co/storage/v1/object/public/public-assets/Gemini_Generated_Image_bn2wfabn2wfabn2w.png',
            url: '/'
          });
          try {
            await webpush.sendNotification(user.push_subscription, payload);
            delivered++;
          } catch (pushErr) {
            failed++;
          }
        })
      );
    } else {
      delivered = recipients.length;
    }

    return res.status(200).json({
      success: true,
      delivered,
      failed,
      totalEligible: recipients.length,
      totalUsers: (users || []).length
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || err });
  }
}
