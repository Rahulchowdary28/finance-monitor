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

async function broadcastToAllUsers() {
  const title = process.env.NOTIFICATION_TITLE || "Official Announcement";
  const body = process.env.NOTIFICATION_BODY || "You have a new update!";

  try {
    const { data: users, error } = await supabase
      .from('users_list')
      .select('id, push_subscription')
      .not('push_subscription', 'is', null);

    if (error) throw error;

    console.log(`Sending broadcast to ${users.length} subscriber(s)...`);

    const payload = JSON.stringify({ title, body });

    const pushPromises = users.map(async (user) => {
      try {
        await webpush.sendNotification(user.push_subscription, payload);
        console.log(`✔ Sent to User ID: ${user.id}`);
      } catch (err) {
        console.error(`✘ Failed for User ID: ${user.id} - Code: ${err.statusCode}`);

        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabase
            .from('users_list')
            .update({ push_subscription: null })
            .eq('id', user.id);
        }
      }
    });

    await Promise.all(pushPromises);
    console.log('Broadcast completed!');
  } catch (err) {
    console.error('Broadcast failed:', err.message);
    process.exit(1);
  }
}

broadcastToAllUsers();
