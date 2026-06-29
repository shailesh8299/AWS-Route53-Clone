export type ZoneType = "Public Hosted Zone" | "Private Hosted Zone";
export type RecordType = "A" | "AAAA" | "CNAME" | "TXT" | "MX" | "NS" | "PTR" | "SRV" | "CAA" | "SOA";
export type RoutingPolicy = "Simple" | "Weighted" | "Latency" | "Failover" | "Geolocation" | "Multivalue";

export type AuthUser = {
  id: string;
  username: string;
  email: string | null;
  display_name: string;
};

export type HostedZone = {
  id: string;
  name: string;
  comment: string;
  zone_type: ZoneType;
  caller_reference: string;
  hosted_zone_id: string;   // /hostedzone/ZXXX format
  created_at: string;
  updated_at: string;
  record_count: number;
};

export type DNSRecord = {
  id: string;
  zone_id: string;
  name: string;
  record_type: RecordType;
  ttl: number;
  values: string[];
  routing_policy: RoutingPolicy;
  weight: number | null;
  priority: number | null;
  comment: string;
  alias_target: string;
  created_at: string;
  updated_at: string;
};

export type PageMeta = {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

export type PageResponse<T> = {
  items: T[];
  meta: PageMeta;
};

export type MessageResponse = {
  message: string;
};
