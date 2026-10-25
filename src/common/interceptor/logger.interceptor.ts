import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";

import { Request, Response } from "express";
import { Observable } from "rxjs";
import { catchError, tap } from "rxjs/operators";
import { maskBody } from "../../utils/maskBody";
import { maskHeaders } from "../../utils/maskHeaders";
import { log_body } from "../../types/logger.type";

const DEFAULT_ERROR_STATUS = 500;
const DEFAULT_ERROR_MESSAGE = "Internal server error";

/**
 * สร้าง res_body ของ request ที่ error ให้มีรูปแบบเดียวกับ HttpResponse
 * ที่ global HttpErrorFilter ส่งกลับจริง (ok/status/correlation_id/message)
 */
const resolveErrorBody = (
	error: any,
	correlation_id: string,
): { ok: false; status: number; correlation_id: string; message: any } => {
	if (error instanceof HttpException) {
		const status = error.getStatus();
		const response = error.getResponse();
		const message =
			typeof response === "string"
				? response
				: (response as { message?: any })?.message ?? error.message;

		return { ok: false, status, correlation_id, message };
	}

	return {
		ok: false,
		status: DEFAULT_ERROR_STATUS,
		correlation_id,
		message: DEFAULT_ERROR_MESSAGE,
	};
};

@Injectable()
export class LoggerInterceptor implements NestInterceptor {

	private readonly ReqLogger = new Logger("ReqInterceptor");
	private readonly ResLogger = new Logger("ResInterceptor");

	intercept(
	context: ExecutionContext,
	next: CallHandler,
	): Observable<any> {

	const http = context.switchToHttp();

	const req = http.getRequest<Request>() as unknown as Request & { correlation_id: string };
	const res = http.getResponse<Response>();

	const start = Date.now();

	const correlation_id = req['correlation_id'];
	const req_Log: log_body = {
	correlation_id : correlation_id,
	method: req.method,
	path: req.originalUrl ?? req.url,
	time_diff_ms: Date.now() - start,
	req_headers: maskHeaders(req.headers),
	req_body: maskBody(req.body) ?? {},
	error:null
	};
	this.ReqLogger.log(req_Log);

	let responseData: any;
    let error : any;
	let logged = false;

	// log ครั้งเดียว: "finish" = ส่ง response สำเร็จ, "close" = connection ถูกปิด
	// (client ยกเลิกก่อนจบ) — กันไม่ให้ log ซ้ำสองรอบ
	const writeLog = () => {
		if (logged) {
			return;
		}
		logged = true;

		const res_Log: log_body = {
		correlation_id : correlation_id,
		method: req.method,
		path: req.originalUrl ?? req.url,
		statusCode: res.statusCode,
		time_diff_ms: Date.now() - start,
		res_headers: maskHeaders(
			typeof res.getHeaders === "function" ? res.getHeaders() : null,
		),
		res_body: maskBody(responseData) ?? null,
		error: error
			? {
				name: error.name,
				message: error.message,
			}
			: null,
		};

		this.ResLogger.log(res_Log);
	};

	res.on("finish", writeLog);
	res.on("close", writeLog);

	return next.handle().pipe(
		tap((data) => {
		responseData = data;
		}),
		catchError((err) => {
			error = err;
			// error ไม่มี data ไหลผ่าน tap ทำให้ res_body เดิมเป็น null
			// จึงสร้าง body จาก exception เพื่อให้ log ฝั่ง response ครบถ้วน
			responseData = resolveErrorBody(err, correlation_id);
			throw err;
		}),
	);
	}
}
