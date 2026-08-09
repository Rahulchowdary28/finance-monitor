// sw.js - Service Worker for Web Push Notifications

// 1. Listen for incoming push messages from the server
self.addEventListener('push', (event) => {
  let data = { title: 'New Notification', body: 'You have a new update!' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/icon.png', // Optional: Path to an app icon in your project root
    badge: '/badge.png', // Optional: Path to a small monochrome badge icon
    data: {
      url: data.url || '/' // Redirect target when clicked
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// 2. Handle user clicking on the notification
self.addEventListener('notificationclick', (event) => {
  event.notification.close(); // Close the notification popup

  // Open the app or focus the existing tab
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If the app is already open, focus it
      for (let client of windowClients) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise, open a new window/tab to the URL
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
