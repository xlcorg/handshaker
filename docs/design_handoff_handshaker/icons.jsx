// icons.jsx — tiny SVG icon set, Lucide-flavored

const Icon = ({ d, size = 14, fill = "none", stroke = "currentColor", sw = 1.5, children, viewBox = "0 0 24 24", ...p }) => (
  <svg width={size} height={size} viewBox={viewBox} fill={fill} stroke={stroke} strokeWidth={sw}
       strokeLinecap="round" strokeLinejoin="round" {...p}>
    {children || (d ? <path d={d} /> : null)}
  </svg>
);

const Icons = {
  Logo: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {/* abstract handshake — two interlocking brackets */}
      <path d="M4 9 L9 4 L13 8" />
      <path d="M20 15 L15 20 L11 16" />
      <path d="M8 12 L12 8 L16 12 L12 16 Z" />
    </svg>
  ),
  Search: (p) => <Icon {...p}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></Icon>,
  Lock: (p) => <Icon {...p}><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></Icon>,
  Unlock: (p) => <Icon {...p}><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></Icon>,
  Plus: (p) => <Icon {...p}><path d="M12 5v14M5 12h14"/></Icon>,
  Send: (p) => <Icon {...p}><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4 20-7Z"/></Icon>,
  Stop: (p) => <Icon {...p}><rect x="6" y="6" width="12" height="12" rx="1.5"/></Icon>,
  Chevron: (p) => <Icon {...p}><path d="m9 6 6 6-6 6"/></Icon>,
  ChevronDown: (p) => <Icon {...p}><path d="m6 9 6 6 6-6"/></Icon>,
  Settings: (p) => <Icon {...p}>
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </Icon>,
  Cog: (p) => <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12"/></Icon>,
  Folder: (p) => <Icon {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></Icon>,
  Bookmark: (p) => <Icon {...p}><path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></Icon>,
  Braces: (p) => <Icon {...p}><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/></Icon>,
  Boxes: (p) => <Icon {...p}><path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"/><path d="m7 16.5-4.74-2.85"/><path d="m7 16.5 5-3"/><path d="M7 16.5v5.17"/><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"/><path d="m17 16.5-5-3"/><path d="m17 16.5 4.74-2.85"/><path d="M17 16.5v5.17"/><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"/><path d="M12 8 7.26 5.15"/><path d="m12 8 4.74-2.85"/><path d="M12 13.5V8"/></Icon>,
  Clock: (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></Icon>,
  Cube: (p) => <Icon {...p}><path d="m21 16.5-9 5-9-5V7.5L12 2.5l9 5z"/><path d="m3 7.5 9 5 9-5"/><path d="M12 12.5v9"/></Icon>,
  Layers: (p) => <Icon {...p}><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></Icon>,
  Key: (p) => <Icon {...p}><circle cx="7.5" cy="15.5" r="3.5"/><path d="m10 13 9-9 3 3-3 3-2-2-2 2-2-2-3 3"/></Icon>,
  Globe: (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></Icon>,
  X: (p) => <Icon {...p}><path d="M18 6 6 18M6 6l12 12"/></Icon>,
  Min: (p) => <Icon {...p}><path d="M5 12h14"/></Icon>,
  Max: (p) => <Icon {...p}><rect x="4" y="4" width="16" height="16" rx="1"/></Icon>,
  Sun: (p) => <Icon {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></Icon>,
  Moon: (p) => <Icon {...p}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></Icon>,
  Trash: (p) => <Icon {...p}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></Icon>,
  Upload: (p) => <Icon {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></Icon>,
  Copy: (p) => <Icon {...p}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></Icon>,
  Wrap: (p) => <Icon {...p}><path d="M3 6h18M3 12h13a3 3 0 0 1 0 6h-2M3 18h7"/><path d="m18 15-3 3 3 3"/></Icon>,
  Beautify: (p) => <Icon {...p}><path d="M3 6h12M3 12h18M3 18h9"/></Icon>,
  Split: (p) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18"/></Icon>,
  PanelLeft: (p) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></Icon>,
  CircleDot: ({ color = "currentColor", size = 8 }) => (
    <svg width={size} height={size} viewBox="0 0 8 8"><circle cx="4" cy="4" r="3.5" fill={color}/></svg>
  ),
  AlertCircle: (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></Icon>,
  CheckCircle: (p) => <Icon {...p}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></Icon>,
  Activity: (p) => <Icon {...p}><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></Icon>,
};

window.Icons = Icons;
window.Icon = Icon;
