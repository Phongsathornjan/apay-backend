export type log_body = {
 correlation_id: string;
 method: string;
 path: string;
 statusCode?: number;
 time_diff_ms: number;
 req_headers?: Record<string, any> | null;
 req_body?: any | null;
 res_headers?: Record<string, any> | null;
 res_body?: any | null;
 error?: {
    name: string;
    message: string;
 } | null;
}
