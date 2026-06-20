import { defineType, defineField } from "sanity";

export default defineType({
  name: "song",
  title: "Song",
  type: "document",
  fields: [
    defineField({ name: "videoId", title: "YouTube Video ID", type: "string" }),
    defineField({ name: "title", title: "Title", type: "string" }),
    defineField({ name: "channel", title: "Channel / Artist", type: "string" }),
    defineField({ name: "thumbnail", title: "Thumbnail URL", type: "url" }),
    defineField({ name: "duration", title: "Duration (display)", type: "string" }),
    defineField({
      name: "durationSeconds",
      title: "Duration (seconds)",
      type: "number",
    }),
    defineField({ name: "audioFile", title: "Audio file", type: "file" }),
    defineField({ name: "audioUrl", title: "Audio CDN URL", type: "url" }),
    defineField({ name: "createdAt", title: "Created at", type: "datetime" }),
  ],
  orderings: [
    {
      title: "Newest first",
      name: "createdDesc",
      by: [{ field: "createdAt", direction: "desc" }],
    },
  ],
  preview: {
    select: { title: "title", subtitle: "channel" },
  },
});
