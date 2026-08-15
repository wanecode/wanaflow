export function newFormSource(name: string) {
  return JSON.stringify({
    schemaVersion: 19,
    type: "default",
    id: `Form_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
    components: [
      {
        id: `Text_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
        type: "text",
        text: `# ${name}\n\nAdd just enough context for the person completing this work.`,
      },
      {
        id: `Field_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
        type: "textfield",
        key: "requesterName",
        label: "Requester name",
        validate: { required: true },
      },
      {
        id: `Field_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
        type: "textarea",
        key: "notes",
        label: "Notes",
      },
    ],
  }, null, 2);
}
