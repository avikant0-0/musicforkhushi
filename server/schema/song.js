/*
  Optional Sanity Studio schema for the `song` document.

  The server does NOT need this — it reads/writes documents directly via the
  client (datasets are schemaless). Drop this into a Sanity Studio's schema
  (e.g. `npx sanity@latest init`, then add to schemaTypes) only if you want a
  UI to browse / manage the extracted song library.
*/
export default {
  name: "song",
  title: "Song",
  type: "document",
  fields: [
    { name: "videoId", title: "YouTube Video ID", type: "string" },
    { name: "title", title: "Title", type: "string" },
    { name: "channel", title: "Channel / Artist", type: "string" },
    { name: "thumbnail", title: "Thumbnail URL", type: "url" },
    { name: "duration", title: "Duration (display)", type: "string" },
    { name: "durationSeconds", title: "Duration (seconds)", type: "number" },
    { name: "audioFile", title: "Audio file", type: "file" },
    { name: "audioUrl", title: "Audio CDN URL", type: "url" },
    { name: "createdAt", title: "Created at", type: "datetime" },
  ],
  preview: {
    select: { title: "title", subtitle: "channel", media: "audioFile" },
  },
};
