import type { DashboardInterval } from '../../enums/dashboard-interval.enum';
import { BusinessSubscriptionStatus } from '../../subscriptions/entities/business-subscription.entity';

export type { DashboardInterval };

export interface DashboardRange {
  from: string;
  to: string;
  interval: DashboardInterval;
  timezone: 'Asia/Bangkok';
}

export interface DashboardSeriesPoint {
  bucket_start: string;
  label: string;
  value: number;
}

export interface DashboardSeries {
  key: string;
  label: string;
  points: DashboardSeriesPoint[];
}

export interface DashboardPagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface DashboardSubscriptionSummary {
  id: string;
  package_id: string;
  package_code: string | null;
  package_name: string | null;
  status: BusinessSubscriptionStatus;
  quota_limit: number;
  quota_used: number;
  quota_remaining: number;
  rate_limit_per_hour: number;
  max_api_keys: number;
  current_period_start: string;
  current_period_end: string;
  last_payment_at: string | null;
  days_until_period_end: number;
}

export interface DashboardOverviewResponse {
  range: DashboardRange;
  business: {
    id: string;
    name: string;
  };
  subscription: DashboardSubscriptionSummary | null;
  usage: {
    qr_created: number;
    qr_paid: number;
    quota_deducted: number;
    paid_rate: number;
  };
  transactions: {
    orders_created: number;
    paid_count: number;
    expired_count: number;
    active_unverified_count: number;
    gmv: number;
    average_order_value: number;
    paid_rate: number;
  };
  api_keys: {
    used: number;
    active: number;
    max: number;
  };
  rate_limit: {
    requests_last_hour: number;
    limit: number;
    remaining: number;
    utilization: number;
  };
  webhook: {
    matched: number;
  };
}

export interface DashboardUsageTimeseriesResponse {
  range: DashboardRange;
  series: DashboardSeries[];
}

export interface DashboardTransactionsTimeseriesResponse {
  range: DashboardRange;
  series: DashboardSeries[];
  status_breakdown: {
    PAID: number;
    UNVERIFIED: {
      active: number;
      expired: number;
    };
    EXPIRED: number;
  };
}

export interface DashboardRateLimitResponse {
  business_id: string;
  requests_last_hour: number;
  limit_per_hour: number;
  remaining: number;
  utilization: number;
  series: DashboardSeriesPoint[];
}

export interface DashboardApiKeyBreakdownItem {
  id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  last_used_at: string | null;
  qr_created: number;
  qr_paid: number;
  quota_deducted: number;
  share_of_created: number;
  share_of_paid: number;
}

export interface DashboardApiKeyBreakdownResponse {
  range: DashboardRange;
  summary: {
    total_keys: number;
    active_keys: number;
    revoked_keys: number;
    max_api_keys: number;
  };
  keys: DashboardApiKeyBreakdownItem[];
}

export interface DashboardApiKeyTimeseriesResponse {
  range: DashboardRange;
  series: DashboardSeries[];
}

export interface DashboardQuotaDailyPoint {
  bucket_start: string;
  label: string;
  quota_deducted: number;
  cumulative_used: number;
  quota_remaining: number;
}

export interface DashboardSubscriptionPeriodItem {
  id: string;
  subscription_id: string;
  business_id: string;
  package_id: string;
  period_start: string;
  period_end: string;
  quota_limit: number;
  quota_used: number;
  utilization: number;
  created_at: string;
}

export interface DashboardSubscriptionTrendResponse {
  current: DashboardSubscriptionSummary | null;
  quota: {
    daily: DashboardQuotaDailyPoint[];
  };
  periods: DashboardSubscriptionPeriodItem[];
}

export interface AdminOverviewResponse {
  range: DashboardRange;
  businesses: {
    total: number;
    active: number;
    new_in_range: number;
  };
  subscriptions: {
    active: number;
    past_due: number;
    cancelled: number;
    expiring_7d: number;
    expiring_30d: number;
  };
  platform: {
    orders_created: number;
    paid_count: number;
    expired_count: number;
    active_unverified_count: number;
    gmv: number;
    average_order_value: number;
    paid_rate: number;
    qr_created: number;
    qr_paid: number;
  };
  webhook: {
    matched: number;
    no_match: number;
    match_rate: number;
  };
  estimated_mrr: number;
  estimated_arr: number;
}

export interface AdminTimeseriesResponse {
  range: DashboardRange;
  series: DashboardSeries[];
}

export interface AdminPackageDistributionItem {
  package_id: string;
  code: string;
  name: string;
  price: number;
  business_count: number;
  active_count: number;
  past_due_count: number;
}

export interface AdminStatusDistributionItem {
  status: BusinessSubscriptionStatus;
  count: number;
}

export type QuotaUtilizationBucket =
  | '0-25'
  | '26-50'
  | '51-75'
  | '76-100'
  | '100+';

export interface AdminQuotaUtilizationItem {
  bucket: QuotaUtilizationBucket;
  count: number;
}

export interface AdminDistributionResponse {
  packages: AdminPackageDistributionItem[];
  subscription_status: AdminStatusDistributionItem[];
  quota_utilization: AdminQuotaUtilizationItem[];
}

export interface AdminBusinessListItem {
  business_id: string;
  business_name: string;
  package_code: string | null;
  package_name: string | null;
  subscription_status: BusinessSubscriptionStatus | null;
  quota_limit: number | null;
  quota_used: number | null;
  quota_remaining: number | null;
  current_period_end: string | null;
  last_payment_at: string | null;
  api_keys_used: number;
  api_keys_max: number | null;
  qr_created: number;
  qr_paid: number;
  gmv: number;
}

export interface AdminBusinessesResponse {
  range: DashboardRange;
  pagination: DashboardPagination;
  items: AdminBusinessListItem[];
}

export interface AdminExpiringSubscriptionItem {
  business_id: string;
  business_name: string;
  subscription_id: string;
  status: BusinessSubscriptionStatus;
  current_period_end: string;
  days_remaining: number;
  quota_remaining: number;
  quota_limit: number;
}

export interface AdminNearQuotaSubscriptionItem {
  business_id: string;
  business_name: string;
  subscription_id: string;
  status: BusinessSubscriptionStatus;
  current_period_end: string;
  quota_used: number;
  quota_limit: number;
  quota_remaining: number;
  utilization: number;
}

export interface AdminExpiringResponse {
  expiring: AdminExpiringSubscriptionItem[];
  near_quota: AdminNearQuotaSubscriptionItem[];
}
