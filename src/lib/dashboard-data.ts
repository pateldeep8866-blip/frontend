export type Stat = {
  label: string;
  value: string;
  delta: string;
};

export type Activity = {
  id: string;
  title: string;
  detail: string;
  time: string;
};

export const stats: Stat[] = [
  { label: "Active Agents", value: "24", delta: "+4.3%" },
  { label: "Resolved Tasks", value: "1,284", delta: "+8.1%" },
  { label: "Avg Response", value: "640ms", delta: "-12.5%" },
  { label: "System Health", value: "99.98%", delta: "+0.2%" },
];

export const activities: Activity[] = [
  {
    id: "evt-01",
    title: "Model routing updated",
    detail: "Switched low-latency traffic to edge cluster.",
    time: "2m ago",
  },
  {
    id: "evt-02",
    title: "Knowledge sync completed",
    detail: "19 sources indexed with zero failed fetches.",
    time: "17m ago",
  },
  {
    id: "evt-03",
    title: "Automation triggered",
    detail: "Daily insights digest sent to 12 recipients.",
    time: "42m ago",
  },
];
