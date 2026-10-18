import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";

import { Request, Response } from "express";
import { Observable } from "rxjs";
import { catchError, tap } from "rxjs/operators";
import { maskBody } from "../../utils/maskBody";
import { log_body } from "../../types/logger.type";

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
	statusCode: res.statusCode,
	time_diff_ms: Date.now() - start,
	req_body: maskBody(req.body) ?? {},
	error:null
	};
	this.ReqLogger.log(req_Log);

	let responseData: any;
    let error : any;

	res.on("finish", () => {
		const res_Log: log_body = {
        correlation_id : correlation_id,
		method: req.method,
		path: req.originalUrl ?? req.url,
		statusCode: res.statusCode,
		time_diff_ms: Date.now() - start,
		res_body: maskBody(responseData),
		error: error
			? {
				name: error.name,
				message: error.message,
			}
			: undefined,
		};

		this.ResLogger.log(res_Log);
	});

	return next.handle().pipe(
		tap((data) => {
		responseData = data;
		}),
		catchError((err) => {
			error = err;
			throw err;
		}),
	);
	}
}