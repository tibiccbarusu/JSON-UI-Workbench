# Security

JSON UI Workbench is a local development tool. Keep its Node server bound to
loopback. Do not expose it directly to the Internet or treat it as a multi-user
hosting service. GitHub Pages cannot host the Node worker/backend.

Imported archives are data. The tool must not execute behavior-pack scripts,
shell commands, or arbitrary JavaScript from a pack. Preserve path, archive-size,
expanded-node, processing-time, and response-size limits when changing code.

If you discover a path escape, code execution, information leak, or denial of
service, use GitHub's private vulnerability reporting when the repository owner
has enabled it. Otherwise open an issue asking for a private contact without
posting exploit files, credentials, or private packs. No private reporting
address has been invented for this project.

Before sharing a diagnostic bundle, inspect it for paths, names, pack content and
secrets. Redaction is a convenience, not a guarantee that every custom field is
safe to publish.
