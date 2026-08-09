import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

webpush.setVapidDetails(
  process.env.ADMIN_EMAIL,
  process.env.PUBLIC_VAPID_KEY,
  process.env.PRIVATE_VAPID_KEY
);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // Allow manual POST triggers from Admin UI or external requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const { title = "Official Announcement", message = "You have a new update!" } = req.body || {};

  try {
    const { data: users, error } = await supabase
      .from('users_list')
      .select('id, push_subscription')
      .not('push_subscription', 'is', null);

    if (error) throw error;

    if (!users || users.length === 0) {
      return res.status(200).json({ success: true, message: 'No registered subscribers found.' });
    }

    const payload = JSON.stringify({ title, body: message });

    const pushPromises = users.map(async (user) => {
      try {
        let sub = user.push_subscription;
        if (typeof sub === 'string') sub = JSON.parse(sub);

        if (!sub || !sub.endpoint) return;

        await webpush.sendNotification(sub, payload);
      } catch (err) {
        console.error(`Failed sending to user ${user.id}:`, err.message);

        // Remove invalid/expired subscriptions
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabase
            .from('users_list')
            .update({ push_subscription: null })
            .eq('id', user.id);
        }
      }
    });

    await Promise.all(pushPromises);

    return res.status(200).json({ 
      success: true, 
      message: `Broadcast delivered to ${users.length} device(s).` 
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
