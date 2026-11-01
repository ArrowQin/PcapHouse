/**
 * Static classification for Wireshark/sharkd protocol short-names.
 *
 * Why this exists
 * ---------------
 * sharkd's `protocols` command returns a flat list of ~3000 protocol
 * short-names with no hierarchical/grouping metadata. The Protocols
 * management page is unusable at that scale without some form of
 * categorization, so we maintain a best-effort mapping here.
 *
 * Scope & philosophy
 * ------------------
 * - This is NOT a perfect OSI taxonomy. Many Wireshark dissectors don't
 *   fit a single OSI layer (e.g. QUIC is transport but carries
 *   application framing). We group by what a pcap analyst would
 *   *actually* look for when filtering.
 * - The map only needs to cover the common cases; anything unmapped
 *   falls through to `other`. Users can always fall back to the search
 *   box for exotic names.
 * - Keys are lowercased sharkd short-names. Comparisons must lowercase
 *   the input first (callers should do this once up-front).
 * - When a name could legitimately fit two categories (e.g. `ssdp` is
 *   both Discovery and UPnP/Multimedia), we pick whichever category the
 *   user is most likely to filter by when analyzing pcaps.
 *
 * Maintenance
 * -----------
 * Do NOT try to exhaustively list everything sharkd supports — that's a
 * losing battle. Instead, add entries pragmatically when users say "I
 * can't find X". The default `other` bucket is a perfectly fine home
 * for the long tail.
 */

export type CategoryId =
  | 'link'
  | 'network'
  | 'transport'
  | 'routing'
  | 'web'
  | 'mail'
  | 'auth_security'
  | 'voip_media'
  | 'messaging'
  | 'file_sharing'
  | 'database'
  | 'remote_access'
  | 'discovery'
  | 'iot'
  | 'industrial'
  | 'telecom_cellular'
  | 'management'
  | 'wireless'
  | 'crypto'
  | 'other';

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  /** Short blurb shown as a tooltip / subtitle on the group header. */
  hint: string;
  /** Tailwind text / bg tokens — we keep these generic so the UI can
   *  compose them freely. */
  accent: string; // e.g. 'text-sky-300'
  accentBg: string; // e.g. 'bg-sky-500/10'
  accentBorder: string; // e.g. 'border-sky-500/30'
}

/**
 * Display order for the category chips and group sections. `other` is
 * always last — it's the catch-all and tends to be the largest bucket.
 */
export const CATEGORIES: CategoryMeta[] = [
  {
    id: 'link',
    label: 'Link layer',
    hint: 'Ethernet, ARP, STP, LLDP and other L2 protocols',
    accent: 'text-sky-300',
    accentBg: 'bg-sky-500/10',
    accentBorder: 'border-sky-500/30',
  },
  {
    id: 'network',
    label: 'Network',
    hint: 'IPv4/IPv6, ICMP, IPsec, tunneling',
    accent: 'text-blue-300',
    accentBg: 'bg-blue-500/10',
    accentBorder: 'border-blue-500/30',
  },
  {
    id: 'transport',
    label: 'Transport',
    hint: 'TCP, UDP, QUIC, SCTP',
    accent: 'text-indigo-300',
    accentBg: 'bg-indigo-500/10',
    accentBorder: 'border-indigo-500/30',
  },
  {
    id: 'routing',
    label: 'Routing',
    hint: 'BGP, OSPF, RIP, IS-IS, MPLS',
    accent: 'text-violet-300',
    accentBg: 'bg-violet-500/10',
    accentBorder: 'border-violet-500/30',
  },
  {
    id: 'web',
    label: 'Web & HTTP',
    hint: 'HTTP/1-3, WebSocket, HTTP headers, media types',
    accent: 'text-amber-300',
    accentBg: 'bg-amber-500/10',
    accentBorder: 'border-amber-500/30',
  },
  {
    id: 'mail',
    label: 'Mail',
    hint: 'SMTP, IMAP, POP3 and related',
    accent: 'text-yellow-300',
    accentBg: 'bg-yellow-500/10',
    accentBorder: 'border-yellow-500/30',
  },
  {
    id: 'auth_security',
    label: 'Auth & security',
    hint: 'TLS, SSH, Kerberos, LDAP, RADIUS, SAML',
    accent: 'text-emerald-300',
    accentBg: 'bg-emerald-500/10',
    accentBorder: 'border-emerald-500/30',
  },
  {
    id: 'voip_media',
    label: 'VoIP & media',
    hint: 'SIP, RTP/RTCP, SDP, H.323, streaming',
    accent: 'text-pink-300',
    accentBg: 'bg-pink-500/10',
    accentBorder: 'border-pink-500/30',
  },
  {
    id: 'messaging',
    label: 'Messaging & RPC',
    hint: 'MQTT, AMQP, Kafka, gRPC, XMPP, IRC',
    accent: 'text-teal-300',
    accentBg: 'bg-teal-500/10',
    accentBorder: 'border-teal-500/30',
  },
  {
    id: 'file_sharing',
    label: 'File sharing',
    hint: 'SMB, NFS, FTP, SFTP, AFP',
    accent: 'text-orange-300',
    accentBg: 'bg-orange-500/10',
    accentBorder: 'border-orange-500/30',
  },
  {
    id: 'database',
    label: 'Database',
    hint: 'MySQL, PostgreSQL, MSSQL (TDS), MongoDB, Redis',
    accent: 'text-rose-300',
    accentBg: 'bg-rose-500/10',
    accentBorder: 'border-rose-500/30',
  },
  {
    id: 'remote_access',
    label: 'Remote access',
    hint: 'RDP, VNC, Telnet, Rlogin',
    accent: 'text-fuchsia-300',
    accentBg: 'bg-fuchsia-500/10',
    accentBorder: 'border-fuchsia-500/30',
  },
  {
    id: 'discovery',
    label: 'Discovery & naming',
    hint: 'DNS, mDNS, SSDP, DHCP, NTP, NetBIOS',
    accent: 'text-cyan-300',
    accentBg: 'bg-cyan-500/10',
    accentBorder: 'border-cyan-500/30',
  },
  {
    id: 'iot',
    label: 'IoT & smart home',
    hint: 'CoAP, Zigbee, Thread, Matter, Z-Wave',
    accent: 'text-lime-300',
    accentBg: 'bg-lime-500/10',
    accentBorder: 'border-lime-500/30',
  },
  {
    id: 'industrial',
    label: 'Industrial / SCADA',
    hint: 'Modbus, DNP3, IEC-61850, S7COMM, OPC UA',
    accent: 'text-green-300',
    accentBg: 'bg-green-500/10',
    accentBorder: 'border-green-500/30',
  },
  {
    id: 'telecom_cellular',
    label: 'Telecom & cellular',
    hint: 'GTP, Diameter, SCCP, MAP, S1AP, NAS-5GS',
    accent: 'text-red-300',
    accentBg: 'bg-red-500/10',
    accentBorder: 'border-red-500/30',
  },
  {
    id: 'management',
    label: 'Management',
    hint: 'SNMP, syslog, NetFlow, IPFIX',
    accent: 'text-purple-300',
    accentBg: 'bg-purple-500/10',
    accentBorder: 'border-purple-500/30',
  },
  {
    id: 'wireless',
    label: 'Wireless',
    hint: 'IEEE 802.11 (Wi-Fi), Bluetooth, WPA, EAPoL',
    accent: 'text-sky-300',
    accentBg: 'bg-sky-500/10',
    accentBorder: 'border-sky-500/30',
  },
  {
    id: 'crypto',
    label: 'Crypto & identity',
    hint: 'PKIX/X.509, OCSP, PKCS, ASN.1',
    accent: 'text-slate-300',
    accentBg: 'bg-slate-500/10',
    accentBorder: 'border-slate-500/30',
  },
  {
    id: 'other',
    label: 'Other',
    hint: 'Everything not yet mapped to a category',
    accent: 'text-muted-dark',
    accentBg: 'bg-dark-700',
    accentBorder: 'border-dark-500',
  },
];

// Lookup helper for UI code that needs accent colors from an id.
export const CATEGORY_BY_ID: Record<CategoryId, CategoryMeta> = CATEGORIES.reduce(
  (acc, c) => {
    acc[c.id] = c;
    return acc;
  },
  {} as Record<CategoryId, CategoryMeta>
);

/**
 * Exact-match table. Keys are lowercased sharkd short-names.
 *
 * When in doubt we lean toward what a pcap analyst would intuitively
 * filter by — e.g. `ssdp` is discovery, not multimedia, even though it
 * underpins UPnP streaming.
 */
const EXACT: Record<string, CategoryId> = {
  // --- Link layer --------------------------------------------------------
  eth: 'link',
  ethernet: 'link',
  arp: 'link',
  rarp: 'link',
  stp: 'link',
  rstp: 'link',
  mstp: 'link',
  lldp: 'link',
  cdp: 'link',
  vlan: 'link',
  'ieee8021ah': 'link',
  'ieee8021q': 'link',
  ppp: 'link',
  pppoe: 'link',
  pppoed: 'link',
  slll: 'link',
  fddi: 'link',
  tokenring: 'link',
  wol: 'link',
  lacp: 'link',

  // --- Network -----------------------------------------------------------
  ip: 'network',
  ipv4: 'network',
  ipv6: 'network',
  icmp: 'network',
  icmpv6: 'network',
  igmp: 'network',
  ipsec: 'network',
  esp: 'network',
  ah: 'network',
  ike: 'network',
  isakmp: 'network',
  gre: 'network',
  geneve: 'network',
  vxlan: 'network',
  nvgre: 'network',
  'ip-over-ib': 'network',
  teredo: 'network',
  '6lowpan': 'network',
  ipcomp: 'network',
  ipv6hopbyhop: 'network',

  // --- Transport ---------------------------------------------------------
  tcp: 'transport',
  udp: 'transport',
  udplite: 'transport',
  sctp: 'transport',
  dccp: 'transport',
  quic: 'transport',

  // --- Routing -----------------------------------------------------------
  bgp: 'routing',
  ospf: 'routing',
  'ospf-v2': 'routing',
  'ospf-v3': 'routing',
  rip: 'routing',
  ripng: 'routing',
  eigrp: 'routing',
  'is-is': 'routing',
  isis: 'routing',
  babel: 'routing',
  lisp: 'routing',
  pim: 'routing',
  mpls: 'routing',
  ldp: 'routing',
  rsvp: 'routing',
  hsrp: 'routing',
  vrrp: 'routing',
  glbp: 'routing',

  // --- Web & HTTP --------------------------------------------------------
  http: 'web',
  http2: 'web',
  http3: 'web',
  websocket: 'web',
  spdy: 'web',
  gquic: 'web',
  json: 'web',
  xml: 'web',
  html: 'web',
  'media-type': 'web',
  'image-gif': 'web',
  'image-jfif': 'web',
  'image-png': 'web',

  // --- Mail --------------------------------------------------------------
  smtp: 'mail',
  imap: 'mail',
  imf: 'mail',
  pop: 'mail',
  pop3: 'mail',

  // --- Auth & security ---------------------------------------------------
  tls: 'auth_security',
  ssl: 'auth_security',
  dtls: 'auth_security',
  ssh: 'auth_security',
  kerberos: 'auth_security',
  krb5: 'auth_security',
  ldap: 'auth_security',
  radius: 'auth_security',
  tacacs: 'auth_security',
  'tacacs+': 'auth_security',
  diameter: 'auth_security',
  ntlmssp: 'auth_security',
  gssapi: 'auth_security',
  eap: 'auth_security',
  eapol: 'auth_security',
  saml: 'auth_security',

  // --- VoIP & media ------------------------------------------------------
  sip: 'voip_media',
  sdp: 'voip_media',
  rtp: 'voip_media',
  rtcp: 'voip_media',
  rtsp: 'voip_media',
  h225: 'voip_media',
  h245: 'voip_media',
  h248: 'voip_media',
  h264: 'voip_media',
  h265: 'voip_media',
  mgcp: 'voip_media',
  megaco: 'voip_media',
  iax2: 'voip_media',
  skinny: 'voip_media',
  rtmp: 'voip_media',
  rtmpt: 'voip_media',
  mms: 'voip_media',

  // --- Messaging & RPC ---------------------------------------------------
  mqtt: 'messaging',
  'mqtt-sn': 'messaging',
  amqp: 'messaging',
  stomp: 'messaging',
  kafka: 'messaging',
  xmpp: 'messaging',
  irc: 'messaging',
  grpc: 'messaging',
  thrift: 'messaging',
  protobuf: 'messaging',
  'protobuf-any': 'messaging',
  dcerpc: 'messaging',
  sunrpc: 'messaging',
  onc_rpc: 'messaging',
  nrpc: 'messaging',

  // --- File sharing ------------------------------------------------------
  smb: 'file_sharing',
  smb2: 'file_sharing',
  smb3: 'file_sharing',
  nfs: 'file_sharing',
  ftp: 'file_sharing',
  'ftp-data': 'file_sharing',
  sftp: 'file_sharing',
  afp: 'file_sharing',
  tftp: 'file_sharing',
  webdav: 'file_sharing',

  // --- Database ----------------------------------------------------------
  mysql: 'database',
  pgsql: 'database',
  postgresql: 'database',
  tds: 'database',
  tns: 'database',
  mongo: 'database',
  mongodb: 'database',
  redis: 'database',
  cql: 'database',
  cassandra: 'database',
  couchdb: 'database',

  // --- Remote access -----------------------------------------------------
  rdp: 'remote_access',
  't.125': 'remote_access',
  't.124': 'remote_access',
  vnc: 'remote_access',
  rfb: 'remote_access',
  telnet: 'remote_access',
  rlogin: 'remote_access',

  // --- Discovery & naming -----------------------------------------------
  dns: 'discovery',
  mdns: 'discovery',
  llmnr: 'discovery',
  nbns: 'discovery',
  nbdgm: 'discovery',
  nbss: 'discovery',
  netbios: 'discovery',
  dhcp: 'discovery',
  dhcpv6: 'discovery',
  bootp: 'discovery',
  ntp: 'discovery',
  sntp: 'discovery',
  ssdp: 'discovery',
  upnp: 'discovery',
  wsdd: 'discovery',

  // --- IoT & smart home --------------------------------------------------
  coap: 'iot',
  zigbee: 'iot',
  zbee: 'iot',
  'zbee-nwk': 'iot',
  'zbee-aps': 'iot',
  'zbee-zcl': 'iot',
  thread: 'iot',
  matter: 'iot',
  zwave: 'iot',
  'z-wave': 'iot',

  // --- Industrial / SCADA ------------------------------------------------
  modbus: 'industrial',
  'modbus-tcp': 'industrial',
  'modbus-rtu': 'industrial',
  dnp3: 'industrial',
  'iec-104': 'industrial',
  iec60870_5_104: 'industrial',
  'iec61850-goose': 'industrial',
  'iec61850-sv': 'industrial',
  s7comm: 'industrial',
  'profinet-cba': 'industrial',
  pn_io: 'industrial',
  pn_dcp: 'industrial',
  pn_rt: 'industrial',
  opcua: 'industrial',
  'opc-ua': 'industrial',
  bacapp: 'industrial',
  bvlc: 'industrial',
  ethercat: 'industrial',
  'ethernet/ip': 'industrial',
  enip: 'industrial',
  cip: 'industrial',
  mms_ease: 'industrial',
  goose: 'industrial',

  // --- Telecom & cellular -----------------------------------------------
  gtp: 'telecom_cellular',
  'gtpv2-c': 'telecom_cellular',
  'gtp-prime': 'telecom_cellular',
  gsm_map: 'telecom_cellular',
  sccp: 'telecom_cellular',
  mtp3: 'telecom_cellular',
  mtp2: 'telecom_cellular',
  s1ap: 'telecom_cellular',
  x2ap: 'telecom_cellular',
  ngap: 'telecom_cellular',
  xnap: 'telecom_cellular',
  'nas-5gs': 'telecom_cellular',
  'nas-eps': 'telecom_cellular',
  pfcp: 'telecom_cellular',
  tcap: 'telecom_cellular',
  cap: 'telecom_cellular',
  inap: 'telecom_cellular',
  'ranap': 'telecom_cellular',
  rrc: 'telecom_cellular',
  'lte-rrc': 'telecom_cellular',
  'nr-rrc': 'telecom_cellular',

  // --- Management --------------------------------------------------------
  snmp: 'management',
  syslog: 'management',
  netflow: 'management',
  cflow: 'management',
  ipfix: 'management',
  cmip: 'management',
  netconf: 'management',
  ipmi: 'management',

  // --- Wireless ----------------------------------------------------------
  'ieee80211': 'wireless',
  wlan: 'wireless',
  'wlan-mgt': 'wireless',
  bt: 'wireless',
  bluetooth: 'wireless',
  btcommon: 'wireless',
  btle: 'wireless',
  btl2cap: 'wireless',
  btsdp: 'wireless',
  btrfcomm: 'wireless',
  btatt: 'wireless',
  bthci_cmd: 'wireless',
  bthci_evt: 'wireless',
  bthci_acl: 'wireless',
  bthci_h4: 'wireless',

  // --- Crypto & identity -------------------------------------------------
  pkix1explicit: 'crypto',
  pkix1implicit: 'crypto',
  x509af: 'crypto',
  x509ce: 'crypto',
  x509if: 'crypto',
  x509sat: 'crypto',
  ocsp: 'crypto',
  pkcs1: 'crypto',
  pkcs12: 'crypto',
  cms: 'crypto',
  ess: 'crypto',
};

/**
 * Prefix-based fallback patterns. Tried in order after EXACT misses.
 * Each entry is `[test, category]`. We keep these conservative because
 * broad prefixes like `gsm-` can easily mis-categorize.
 */
const PREFIX_RULES: Array<[RegExp, CategoryId]> = [
  [/^bt[a-z0-9_]/, 'wireless'], // bluetooth subprotocols
  [/^zbee[-_]/, 'iot'],
  [/^ieee80211[-_]?/, 'wireless'],
  [/^wlan[-_]?/, 'wireless'],
  [/^dhcp/, 'discovery'],
  [/^dns(?:[-_.]|$)/, 'discovery'],
  [/^mdns(?:[-_.]|$)/, 'discovery'],
  [/^http(?:[-_.0-9/]|$)/, 'web'],
  [/^tls(?:[-_.]|$)/, 'auth_security'],
  [/^ssl(?:[-_.]|$)/, 'auth_security'],
  [/^ldap(?:[-_.]|$)/, 'auth_security'],
  [/^kerberos/, 'auth_security'],
  [/^smb(?:[-_.0-9]|$)/, 'file_sharing'],
  [/^nfs(?:[-_.]|$)/, 'file_sharing'],
  [/^gtp(?:[-_.]|$)/, 'telecom_cellular'],
  [/^s7/, 'industrial'],
  [/^iec[-_]?6/, 'industrial'],
  [/^pn[-_]/, 'industrial'],
  [/^modbus/, 'industrial'],
  [/^opc/, 'industrial'],
  [/^rtp(?:[-_.]|$)/, 'voip_media'],
  [/^rtcp(?:[-_.]|$)/, 'voip_media'],
  [/^sip(?:[-_.]|$)/, 'voip_media'],
  [/^h\.?2[0-9]{2}/, 'voip_media'],
  [/^coap(?:[-_.]|$)/, 'iot'],
  [/^mqtt/, 'messaging'],
  [/^amqp/, 'messaging'],
  [/^kafka/, 'messaging'],
  [/^dcerpc/, 'messaging'],
  [/^pkix/, 'crypto'],
  [/^x509/, 'crypto'],
  [/^mysql/, 'database'],
  [/^pgsql|^postgres/, 'database'],
  [/^tds(?:[-_.]|$)/, 'database'],
  [/^mongo/, 'database'],
  [/^ospf/, 'routing'],
  [/^bgp/, 'routing'],
  [/^mpls/, 'routing'],
  [/^ipv?6?[-_]?/, 'network'], // loose; EXACT still wins
  [/^icmp/, 'network'],
  [/^snmp/, 'management'],
  [/^syslog/, 'management'],
  [/^netflow/, 'management'],
  [/^ipfix/, 'management'],
];

/**
 * Classify a single protocol short-name. Callers should lowercase the
 * input once and pass it in. Returns `other` for anything we don't
 * recognize — this is the intentional long-tail bucket.
 */
export function classifyProtocol(name: string): CategoryId {
  if (!name) return 'other';
  const key = name.toLowerCase();
  const exact = EXACT[key];
  if (exact) return exact;
  for (const [re, cat] of PREFIX_RULES) {
    if (re.test(key)) return cat;
  }
  return 'other';
}

/**
 * Group a list of protocol names by category in the canonical display
 * order. Names within each group are sorted alphabetically. Empty
 * groups are omitted from the returned array so the UI doesn't render
 * placeholder sections.
 */
export function groupProtocolsByCategory(
  names: string[]
): Array<{ category: CategoryMeta; names: string[] }> {
  const buckets = new Map<CategoryId, string[]>();
  for (const n of names) {
    const id = classifyProtocol(n);
    const arr = buckets.get(id);
    if (arr) arr.push(n);
    else buckets.set(id, [n]);
  }
  const out: Array<{ category: CategoryMeta; names: string[] }> = [];
  for (const meta of CATEGORIES) {
    const arr = buckets.get(meta.id);
    if (arr && arr.length > 0) {
      arr.sort((a, b) => a.localeCompare(b));
      out.push({ category: meta, names: arr });
    }
  }
  return out;
}
