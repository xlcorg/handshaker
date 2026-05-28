// Sample gRPC services data for Handshaker prototype
window.HS_DATA = {
  services: [
    {
      name: "Xellic.Notex.Presentation.Abstractions.NotesService",
      short: "NotesService",
      methods: [
        { name: "Create", kind: "unary", req: "CreateNoteCommand", res: "CreateNoteCommandResponse" },
        { name: "List", kind: "unary", req: "ListNotesQuery", res: "ListNotesResponse" },
        { name: "Get", kind: "unary", req: "GetNoteQuery", res: "GetNoteResponse" },
        { name: "Delete", kind: "unary", req: "DeleteNoteCommand", res: "DeleteNoteResponse" },
        { name: "WatchUpdates", kind: "server", req: "WatchUpdatesRequest", res: "NoteUpdate" },
      ],
    },
    {
      name: "Xellic.Notex.Presentation.Abstractions.UsersService",
      short: "UsersService",
      methods: [
        { name: "Register", kind: "unary", req: "RegisterUserCommand", res: "RegisterUserResponse" },
        { name: "Authenticate", kind: "unary", req: "AuthenticateQuery", res: "AuthenticateResponse" },
        { name: "Profile", kind: "unary", req: "ProfileQuery", res: "Profile" },
        { name: "UploadAvatar", kind: "client", req: "AvatarChunk", res: "UploadAvatarResponse" },
        { name: "ChatSession", kind: "bidi", req: "ChatMessage", res: "ChatMessage" },
      ],
    },
    {
      name: "grpc.reflection.v1alpha.ServerReflection",
      short: "ServerReflection",
      methods: [
        { name: "ServerReflectionInfo", kind: "bidi", req: "ServerReflectionRequest", res: "ServerReflectionResponse" },
      ],
    },
    {
      name: "grpc.health.v1.Health",
      short: "Health",
      methods: [
        { name: "Check", kind: "unary", req: "HealthCheckRequest", res: "HealthCheckResponse" },
        { name: "Watch", kind: "server", req: "HealthCheckRequest", res: "HealthCheckResponse" },
      ],
    },
  ],

  history: [
    { svc: "NotesService", mth: "Create", st: "ok", lat: "1ms", ts: "14:32:08", env: "prod" },
    { svc: "NotesService", mth: "List", st: "ok", lat: "4ms", ts: "14:31:54", env: "prod" },
    { svc: "UsersService", mth: "Authenticate", st: "err", lat: "12ms", ts: "14:28:11", env: "prod" },
    { svc: "Health", mth: "Check", st: "ok", lat: "0ms", ts: "14:24:02", env: "prod" },
    { svc: "NotesService", mth: "WatchUpdates", st: "stream", lat: "—", ts: "14:18:40", env: "staging" },
    { svc: "NotesService", mth: "Get", st: "ok", lat: "2ms", ts: "13:55:21", env: "staging" },
    { svc: "ServerReflection", mth: "ServerReflectionInfo", st: "ok", lat: "1ms", ts: "13:52:09", env: "prod" },
    { svc: "UsersService", mth: "Profile", st: "ok", lat: "5ms", ts: "13:50:01", env: "prod" },
  ],

  collections: [
    {
      name: "Smoke tests",
      items: [
        { svc: "Health", mth: "Check" },
        { svc: "NotesService", mth: "Create" },
        { svc: "NotesService", mth: "List" },
      ],
    },
    {
      name: "Auth flow",
      items: [
        { svc: "UsersService", mth: "Register" },
        { svc: "UsersService", mth: "Authenticate" },
        { svc: "UsersService", mth: "Profile" },
      ],
    },
  ],

  environments: [
    { name: "prod", color: "#6cd697", host: "api.example.com", vars: 5 },
    { name: "staging", color: "#e5c07a", host: "api.staging.example.com", vars: 5 },
    { name: "local", color: "#7ec8e3", host: "localhost:5002", vars: 3 },
  ],

  // request bodies keyed by `${svc}/${mth}`
  bodies: {
    "NotesService/Create": [
      { ln: "{" },
      { ln: '  "content": "Hello from Handshaker",', kw: "content" },
      { ln: '  "userId": "{{userId}}",', kw: "userId" },
      { ln: '  "tags": ["draft", "todo"],' },
      { ln: '  "priority": 2' },
      { ln: "}" },
    ],
    "NotesService/List": [
      { ln: "{" },
      { ln: '  "userId": "{{userId}}",' },
      { ln: '  "limit": 50,' },
      { ln: '  "cursor": null' },
      { ln: "}" },
    ],
    "NotesService/WatchUpdates": [
      { ln: "{" },
      { ln: '  "userId": "{{userId}}",' },
      { ln: '  "includeDeleted": false' },
      { ln: "}" },
    ],
    "UsersService/Authenticate": [
      { ln: "{" },
      { ln: '  "email": "alice@example.com",' },
      { ln: '  "password": "{{password}}"' },
      { ln: "}" },
    ],
    "Health/Check": [
      { ln: "{" },
      { ln: '  "service": ""' },
      { ln: "}" },
    ],
  },

  responses: {
    success: [
      { ln: "{" },
      { ln: '  "id": "0298d5ce-f6d0-41e7-8230-375690579a02",' },
      { ln: '  "createdAt": "2026-05-28T14:32:08.412Z",' },
      { ln: '  "version": 1' },
      { ln: "}" },
    ],
    error: [
      { ln: "{" },
      { ln: '  "code": "UNAUTHENTICATED",' },
      { ln: '  "message": "missing bearer token in metadata",' },
      { ln: '  "details": []' },
      { ln: "}" },
    ],
  },

  trailers: [
    { k: "content-type", v: "application/grpc" },
    { k: "grpc-status", v: "0" },
    { k: "grpc-accept-encoding", v: "identity, deflate, gzip" },
    { k: "x-trace-id", v: "9f4a2c81-d3b0-4f17-b2e8-c41a7c0bb7e2" },
  ],
};
