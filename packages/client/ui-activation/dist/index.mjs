import { LlmAdapter, LlmError, createUserMessage, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { Service } from "@deepseek-ai/cordis";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { PiAiAdapter, resolveProfiles } from "@deepseek-ai/dsh-llm-pi-ai";
//#region src/continuation.ts
function fresh() {
	return {
		attempts: 0,
		stalled: 0,
		previous: "",
		output: "",
		toolProgress: false,
		truncated: false
	};
}
/** 注册企业路由的自动续接，停止和失败由已有轮次错误界面报告。
* @param ctx 插件上下文，卸载时释放监听。
* @param config 每个人工请求的有限恢复预算，零次数关闭续接。
*/
function registerOutputContinuation(ctx, config) {
	const states = /* @__PURE__ */ new WeakMap();
	const removePending = (agent) => {
		for (const message of [...agent.inbox.nextTurn, ...agent.inbox.nextStep]) if (message.source.kind === "lfclaw-output-continuation") agent.inbox.remove(message.id);
	};
	ctx.effect(() => () => {
		for (const agent of ctx.agents.list()) removePending(agent);
	}, "lfclaw: cancel queued output continuations");
	ctx.on("agent/inbox/inserted", ({ agent, message }) => {
		if (message.source.kind === "user") removePending(agent);
	});
	ctx.on("agent/pre-step", ({ messages }, next) => {
		for (const message of messages) {
			if (message.source.kind !== "lfclaw-output-continuation") continue;
			if (!Number.isSafeInteger(message.source.attempt) || message.source.attempt < 1 || message.source.attempt > config.maxAutoContinuations) throw new LlmError("自动续接记录超出允许范围，已停止。请重新发送任务以继续。", "OUTPUT_CONTINUATION_LIMIT");
		}
		return next();
	});
	ctx.on("session/event", (session, event) => {
		const agent = ctx.agents.get(session.id);
		if (!agent || agent.session !== session) return;
		let state = states.get(agent);
		if (!state) {
			state = fresh();
			states.set(agent, state);
		}
		switch (event.type) {
			case "turn/start":
				state.output = "";
				state.toolProgress = false;
				state.truncated = false;
				return;
			case "user/message":
				if (event.data.source.kind === "lfclaw-output-continuation") state.attempts = Math.max(state.attempts, event.data.source.attempt);
				else if (event.data.source.kind === "user") states.set(agent, fresh());
				return;
			case "assistant/message": {
				state.output += event.data.message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
				const last = event.data.stream.at(-1);
				const finish = last?.type === "chunk" ? last.chunk : void 0;
				state.truncated = finish?.type === "finish" && finish.reason.kind === "max-tokens";
				return;
			}
			case "tool/result":
				if (!event.data.message.isError) state.toolProgress = true;
				return;
			case "turn/end":
				if (event.data.reason.kind !== "max-tokens") {
					states.delete(agent);
					removePending(agent);
				}
				return;
			default: return;
		}
	});
	ctx.on("agent/turn-stopping", ({ agent, signal }) => {
		const state = states.get(agent);
		if (!state || signal.aborted || config.maxAutoContinuations === 0 || agent.session.requestHeader()?.config.provider !== config.provider || !state.truncated) return;
		if (agent.inbox.nextTurn.length || agent.inbox.nextStep.length) {
			states.delete(agent);
			return;
		}
		const output = state.output.trim();
		state.stalled = state.toolProgress || output.length > 0 && output !== state.previous ? 0 : state.stalled + 1;
		state.previous = output;
		if (state.stalled >= config.maxNoProgressContinuations) throw new LlmError("模型连续返回空内容或重复内容，自动续接已停止。已有输出已保留，请调整模型设置或换用模型后重试。", "OUTPUT_CONTINUATION_STALLED");
		if (state.attempts >= config.maxAutoContinuations) throw new LlmError("已达到本次任务的自动续接次数上限，已有输出已保留。请缩小任务范围，或检查模型输出上限后继续。", "OUTPUT_CONTINUATION_LIMIT");
		state.attempts += 1;
		agent.followup(createUserMessage({
			content: [{
				type: "text",
				text: "上一条模型输出因单次输出 token 上限被截断。请从中断处继续完成用户当前任务，保留已完成的工作，不重复已有内容，不重新执行已完成的工具操作；若任务已经完成，直接简洁说明结果。"
			}],
			source: {
				kind: "lfclaw-output-continuation",
				attempt: state.attempts,
				form: "notice",
				summary: "输出达到上限，正在自动继续"
			}
		}));
	});
}
//#endregion
//#region src/connection.ts
/** Host 中的企业请求服务；员工凭据不进入渲染层。 */
/** 仅使用当前激活服务器的员工令牌访问企业接口。 */
var EnterpriseConnection = class extends Service {
	serverUrl;
	timeoutMs;
	storage;
	constructor(ctx, serverUrl, timeoutMs, storage) {
		super(ctx, "enterpriseConnection");
		this.serverUrl = serverUrl;
		this.timeoutMs = timeoutMs;
		this.storage = storage;
	}
	/**
	* 调用当前员工的企业接口，禁止重定向携带凭据。
	* @param path - 企业 API 下的相对路径，由 Host 调用方提供。
	* @param init - 请求参数。
	* @returns 企业接口响应；调用方负责解析数据和处理非成功状态。
	*/
	async request(path, init = {}) {
		const value = await this.storage.read();
		if (!value || typeof value !== "object" || !("serverUrl" in value) || value.serverUrl !== this.serverUrl || !("token" in value) || typeof value.token !== "string") return Response.json({ message: "请先激活企业账号" }, { status: 401 });
		const headers = new Headers(init.headers);
		headers.set("Authorization", `Bearer ${value.token}`);
		return fetch(`${this.serverUrl}/${path}`, {
			...init,
			headers,
			redirect: "error",
			signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs)
		});
	}
};
//#endregion
//#region ../../../vendor/cosmokit/lib/index.js
/** Return true when a value is `null` or `undefined`. */
function isNullable(value) {
	return value === null || value === void 0;
}
/** Return true for non-array object values. */
function isPlainObject(data) {
	return data && typeof data === "object" && !Array.isArray(data);
}
/** Filter object entries and return a new object. */
function filterKeys(object, filter) {
	return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
/** Map object values while preserving the original key set. */
function mapValues(object, transform) {
	return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
/** Pick selected keys from an object, optionally including `undefined` values. */
function pick(source, keys, forced) {
	if (!keys) return { ...source };
	const result = {};
	for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
	return result;
}
/** Shared config references used by schema validators and plugin runtimes. */
const write = Symbol.for("cosmokit.volatile.write");
function snapshot(value, ancestors = /* @__PURE__ */ new Set()) {
	if (typeof value === "function") throw new TypeError("volatile config cannot contain functions");
	if (value === null || typeof value !== "object") return value;
	if (ancestors.has(value)) throw new TypeError("volatile config cannot contain cycles");
	ancestors.add(value);
	try {
		if (Array.isArray(value)) return Object.freeze(value.map((item) => snapshot(item, ancestors)));
		if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError("volatile config objects must be plain objects or arrays");
		return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, ancestors)])));
	} finally {
		ancestors.delete(value);
	}
}
/**
* Create a detached reference containing an immutable copy of the supplied data.
* @param value - validated config data; class instances and functions are unsupported.
* @returns a reference whose value is updated only by its owning runtime.
*/
function createVolatile(value) {
	let current = snapshot(value);
	return Object.freeze({
		get: () => current,
		[write]: (value) => {
			current = value;
		}
	});
}
/**
* Identify references across ESM/CJS copies of the shared library.
* @param value - a parsed config value.
* @returns whether the value implements the shared reference protocol.
*/
function isVolatile(value) {
	return typeof value === "object" && value !== null && write in value;
}
/** Test values using `instanceof` with a `toStringTag` fallback. */
function is(type, value) {
	if (arguments.length === 1) return (value) => is(type, value);
	return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
	return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
	return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
/** Binary source detection and base64/hex conversion helpers. */
var Binary;
(function(Binary) {
	Binary.is = isArrayBufferLike;
	Binary.isSource = isArrayBufferSource;
	function fromSource(source) {
		if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
		else return source;
	}
	Binary.fromSource = fromSource;
	function toBase64(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
		let binary = "";
		const bytes = new Uint8Array(source);
		for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	Binary.toBase64 = toBase64;
	function fromBase64(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
		return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
	}
	Binary.fromBase64 = fromBase64;
	function toHex(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
		return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	Binary.toHex = toHex;
	function fromHex(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
		const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
		const buffer = [];
		for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
		return Uint8Array.from(buffer).buffer;
	}
	Binary.fromHex = fromHex;
})(Binary || (Binary = {}));
Binary.fromBase64;
Binary.toBase64;
Binary.fromHex;
Binary.toHex;
/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
function clone(source, refs = /* @__PURE__ */ new Map()) {
	if (!source || typeof source !== "object") return source;
	if (is("Date", source)) return new Date(source.valueOf());
	if (is("RegExp", source)) return new RegExp(source.source, source.flags);
	if (isArrayBufferLike(source)) return source.slice(0);
	if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
	const cached = refs.get(source);
	if (cached) return cached;
	if (Array.isArray(source)) {
		const result = [];
		refs.set(source, result);
		source.forEach((value, index) => {
			result[index] = Reflect.apply(clone, null, [value, refs]);
		});
		return result;
	}
	const result = Object.create(Object.getPrototypeOf(source));
	refs.set(source, result);
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
		if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
		Reflect.defineProperty(result, key, descriptor);
	}
	return result;
}
/**
* Compare values recursively, treating two volatile references as equal regardless of value.
* Strict comparison distinguishes null/undefined, treats opaque objects by identity,
* compares URLs by normalized href, treats array holes as undefined, and considers distinct cyclic structures unequal.
* @param a - first value.
* @param b - second value.
* @param strict - whether to require strict data equality outside volatile references.
* @returns whether the values compare equal.
*/
function deepEqual(a, b, strict) {
	const ancestors = /* @__PURE__ */ new Set();
	function compare(a, b) {
		if (a === b) return true;
		if (isVolatile(a) || isVolatile(b)) return isVolatile(a) && isVolatile(b);
		if (!strict && isNullable(a) && isNullable(b)) return true;
		if (typeof a !== typeof b || typeof a !== "object" || !a || !b) return false;
		if (ancestors.has(a)) return false;
		function check(test, then) {
			return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
		}
		ancestors.add(a);
		try {
			return check(Array.isArray, (a, b) => {
				if (a.length !== b.length) return false;
				for (let index = 0; index < a.length; index++) if (!compare(a[index], b[index])) return false;
				return true;
			}) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("URL"), (a, b) => a.href === b.href) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
				if (a.byteLength !== b.byteLength) return false;
				const viewA = new Uint8Array(a);
				const viewB = new Uint8Array(b);
				for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
				return true;
			}) ?? ((!strict || [a, b].every((value) => Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) && Object.keys({
				...a,
				...b
			}).every((key) => compare(a[key], b[key])));
		} finally {
			ancestors.delete(a);
		}
	}
	return compare(a, b);
}
/** Time constants plus parsing and formatting helpers. */
var Time;
(function(Time) {
	Time.millisecond = 1;
	Time.second = 1e3;
	Time.minute = Time.second * 60;
	Time.hour = Time.minute * 60;
	Time.day = Time.hour * 24;
	Time.week = Time.day * 7;
	let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
	function setTimezoneOffset(offset) {
		timezoneOffset = offset;
	}
	Time.setTimezoneOffset = setTimezoneOffset;
	function getTimezoneOffset() {
		return timezoneOffset;
	}
	Time.getTimezoneOffset = getTimezoneOffset;
	function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
		if (typeof date === "number") date = new Date(date);
		if (offset === void 0) offset = timezoneOffset;
		return Math.floor((date.valueOf() / Time.minute - offset) / 1440);
	}
	Time.getDateNumber = getDateNumber;
	function fromDateNumber(value, offset) {
		const date = new Date(value * Time.day);
		if (offset === void 0) offset = timezoneOffset;
		return new Date(+date + offset * Time.minute);
	}
	Time.fromDateNumber = fromDateNumber;
	const numeric = /\d+(?:\.\d+)?/.source;
	const timeRegExp = new RegExp(`^${[
		"w(?:eek(?:s)?)?",
		"d(?:ay(?:s)?)?",
		"h(?:our(?:s)?)?",
		"m(?:in(?:ute)?(?:s)?)?",
		"s(?:ec(?:ond)?(?:s)?)?"
	].map((unit) => `(${numeric}${unit})?`).join("")}$`);
	function parseTime(source) {
		const capture = timeRegExp.exec(source);
		if (!capture) return 0;
		return (parseFloat(capture[1]) * Time.week || 0) + (parseFloat(capture[2]) * Time.day || 0) + (parseFloat(capture[3]) * Time.hour || 0) + (parseFloat(capture[4]) * Time.minute || 0) + (parseFloat(capture[5]) * Time.second || 0);
	}
	Time.parseTime = parseTime;
	function parseDate(date) {
		const parsed = parseTime(date);
		if (parsed) date = Date.now() + parsed;
		else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
		else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
		return date ? new Date(date) : /* @__PURE__ */ new Date();
	}
	Time.parseDate = parseDate;
	function format(ms) {
		const abs = Math.abs(ms);
		if (abs >= Time.day - Time.hour / 2) return Math.round(ms / Time.day) + "d";
		else if (abs >= Time.hour - Time.minute / 2) return Math.round(ms / Time.hour) + "h";
		else if (abs >= Time.minute - Time.second / 2) return Math.round(ms / Time.minute) + "m";
		else if (abs >= Time.second) return Math.round(ms / Time.second) + "s";
		return ms + "ms";
	}
	Time.format = format;
	function toDigits(source, length = 2) {
		return source.toString().padStart(length, "0");
	}
	Time.toDigits = toDigits;
	function template(template, time = /* @__PURE__ */ new Date()) {
		return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
	}
	Time.template = template;
})(Time || (Time = {}));
//#endregion
//#region ../../../vendor/schemastery/src/index.ts
const kSchema = Symbol.for("schemastery");
const kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
	constructor(message, options) {
		let prefix = "$";
		for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
		else if (typeof segment === "number") prefix += "[" + segment + "]";
		else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
		if (prefix.startsWith(".")) prefix = prefix.slice(1);
		super((prefix === "$" ? "" : `${prefix} `) + message);
		this.options = options;
		this.name = "ValidationError";
	}
	static is(error) {
		return !!error?.[kValidationError];
	}
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
const Schema = function(options) {
	const schema = function(data, options = {}) {
		return Schema.resolve(data, schema, options)[0];
	};
	if (options.refs) {
		const refs = mapValues(options.refs, (options) => new Schema(options));
		const getRef = (uid) => refs[uid];
		for (const key in refs) {
			const options = refs[key];
			options.sKey = getRef(options.sKey);
			options.inner = getRef(options.inner);
			options.list = options.list && options.list.map(getRef);
			options.dict = options.dict && mapValues(options.dict, getRef);
		}
		return refs[options.uid];
	}
	Object.assign(schema, options);
	if (typeof schema.callback === "string") try {
		schema.callback = new Function("return " + schema.callback)();
	} catch {}
	Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
	Object.setPrototypeOf(schema, Schema.prototype);
	schema.meta ||= {};
	schema.toString = schema.toString.bind(schema);
	return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
	return {
		version: 1,
		vendor: "schemastery",
		validate: (value) => {
			try {
				return { value: Schema.resolve(value, this, {})[0] };
			} catch (error) {
				if (ValidationError.is(error)) return { issues: [{
					message: error.message,
					path: error.options.path
				}] };
				throw error;
			}
		}
	};
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
	if (globalThis.__schemastery_refs__) {
		globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
		return this.uid;
	}
	globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
	globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
	const result = {
		uid: this.uid,
		refs: globalThis.__schemastery_refs__
	};
	globalThis.__schemastery_refs__ = void 0;
	return result;
};
Schema.prototype.set = function set(key, value) {
	this.dict[key] = value;
	return this;
};
Schema.prototype.push = function push(value) {
	this.list.push(value);
	return this;
};
function mergeDesc(original, messages) {
	const result = typeof original === "string" ? { "": original } : { ...original };
	for (const locale in messages) {
		const value = messages[locale];
		if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
		else if (typeof value === "string") result[locale] = value;
	}
	return result;
}
function getInner(value) {
	return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
	return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
	const schema = Schema(this);
	const desc = mergeDesc(schema.meta.description, messages);
	if (Object.keys(desc).length) schema.meta.description = desc;
	if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
		return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
	});
	if (schema.list) schema.list = schema.list.map((inner, index) => {
		return inner.i18n(mapValues(messages, (data = {}) => {
			if (Array.isArray(getInner(data))) return getInner(data)[index];
			if (Array.isArray(data)) return data[index];
			return extractKeys(data);
		}));
	});
	if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
		if (getInner(data)) return getInner(data);
		return extractKeys(data);
	}));
	if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
	return schema;
};
Schema.prototype.extra = function extra(key, value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
};
for (const key of [
	"required",
	"disabled",
	"collapse",
	"hidden",
	"loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.deprecated = function deprecated() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "deprecated",
		type: "danger"
	});
	return schema;
};
Schema.prototype.experimental = function experimental() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "experimental",
		type: "warning"
	});
	return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
	const schema = Schema(this);
	const pattern = pick(regexp, ["source", "flags"]);
	schema.meta = {
		...schema.meta,
		pattern
	};
	return schema;
};
Schema.prototype.simplify = function simplify(value) {
	if (isVolatile(value)) value = value.get();
	if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
	if (isNullable(value)) return value;
	if (this.type === "object" || this.type === "dict") {
		const result = {};
		for (const key in value) {
			const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
			if (this.type === "dict" || !isNullable(item)) result[key] = item;
		}
		if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
		return result;
	} else if (this.type === "array" || this.type === "tuple") {
		const result = [];
		value.forEach((value, index) => {
			const schema = this.type === "array" ? this.inner : this.list[index];
			const item = schema ? schema.simplify(value) : value;
			result.push(item);
		});
		return result;
	} else if (this.type === "intersect") {
		const result = {};
		for (const item of this.list) Object.assign(result, item.simplify(value));
		return result;
	} else if (this.type === "union") for (const schema of this.list) try {
		Schema.resolve(value, schema, {});
		return schema.simplify(value);
	} catch {}
	return value;
};
Schema.prototype.toString = function toString(inline) {
	return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		role,
		extra
	};
	return schema;
};
for (const key of [
	"default",
	"link",
	"comment",
	"description",
	"max",
	"min",
	"step"
]) Object.assign(Schema.prototype, { [key](value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.volatile = function volatile() {
	if (this.meta.volatile) throw new TypeError("volatile schema is already wrapped");
	return this.extra("volatile", true);
};
const resolvers = {};
const checkedVolatile = Symbol("checked-volatile-schema");
function validateVolatileSchema(schema, path = [], blocked = false, seen = /* @__PURE__ */ new Map()) {
	const states = seen.get(schema) ?? /* @__PURE__ */ new Set();
	if (states.has(blocked)) return;
	states.add(blocked);
	seen.set(schema, states);
	if (schema.meta?.volatile && blocked) throw new ValidationError("volatile fields require a fixed object path without an enclosing volatile field", { path });
	const nested = blocked || !!schema.meta?.volatile;
	if (schema.dict) for (const [key, child] of Object.entries(schema.dict)) validateVolatileSchema(child, [...path, key], nested, seen);
	if (schema.sKey) validateVolatileSchema(schema.sKey, [...path, "<key>"], true, seen);
	if (schema.inner && (schema.type !== "lazy" || schema.inner[kSchema])) validateVolatileSchema(schema.inner, [...path, "*"], true, seen);
	if (schema.list) for (let index = 0; index < schema.list.length; index++) validateVolatileSchema(schema.list[index], [...path, String(index)], true, seen);
}
Schema.extend = function extend(type, resolve) {
	resolvers[type] = resolve;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
	if (!schema) return [data];
	if (!options[checkedVolatile]) {
		validateVolatileSchema(schema, options.path);
		options = {
			...options,
			[checkedVolatile]: true
		};
	}
	if (schema.meta?.volatile) {
		const inner = Schema(schema);
		inner.meta = {
			...schema.meta,
			volatile: false
		};
		const [value, adapted] = Schema.resolve(data, inner, options, strict);
		try {
			return [createVolatile(value), adapted];
		} catch (error) {
			throw new ValidationError(error instanceof Error ? error.message : String(error), options);
		}
	}
	if (options.ignore?.(data, schema)) return [data];
	if (isNullable(data) && schema.type !== "lazy") {
		if (schema.meta.required) throw new ValidationError(`missing required value`, options);
		let current = schema;
		let fallback = schema.meta.default;
		while (current?.type === "intersect" && isNullable(fallback)) {
			current = current.list[0];
			fallback = current?.meta.default;
		}
		if (isNullable(fallback)) return [data];
		data = clone(fallback);
	}
	const callback = resolvers[schema.type];
	if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
	try {
		return callback(data, schema, options, strict);
	} catch (error) {
		if (!schema.meta.loose) throw error;
		return [schema.meta.default];
	}
};
Schema.from = function from(source) {
	if (isNullable(source)) return Schema.any();
	else if ([
		"string",
		"number",
		"boolean"
	].includes(typeof source)) return Schema.const(source).required();
	else if (source[kSchema]) return source;
	else if (typeof source === "function") switch (source) {
		case String: return Schema.string().required();
		case Number: return Schema.number().required();
		case Boolean: return Schema.boolean().required();
		case Function: return Schema.function().required();
		default: return Schema.is(source).required();
	}
	else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
	const toJSON = () => {
		if (!schema.inner[kSchema]) {
			schema.inner = schema.builder();
			schema.inner.meta = {
				...schema.meta,
				...schema.inner.meta
			};
		}
		return schema.inner.toJSON();
	};
	const schema = new Schema({
		type: "lazy",
		builder,
		inner: { toJSON }
	});
	return schema;
};
Schema.natural = function natural() {
	return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
	return Schema.number().step(.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
	return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
		const date = new Date(value);
		if (isNaN(+date)) throw new ValidationError(`invalid date "${value}"`, options);
		return date;
	}, true)]);
};
Schema.regExp = function regExp(flag = "") {
	return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
		try {
			return new RegExp(value, flag);
		} catch (e) {
			throw new ValidationError(e.message, options);
		}
	}, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
	return Schema.union([
		Schema.is(ArrayBuffer),
		Schema.is(SharedArrayBuffer),
		Schema.transform(Schema.any(), (value, options) => {
			if (Binary.isSource(value)) return Binary.fromSource(value);
			throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
		}, true),
		...encoding ? [Schema.transform(Schema.string(), (value, options) => {
			try {
				return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
			} catch (e) {
				throw new ValidationError(e.message, options);
			}
		}, true)] : []
	]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
	if (!schema.inner[kSchema]) {
		schema.inner = schema.builder();
		schema.inner.meta = {
			...schema.meta,
			...schema.inner.meta
		};
		validateVolatileSchema(schema.inner, options.path, true);
	}
	return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
	return [data];
});
Schema.extend("never", (data, _, options) => {
	throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
	if (deepEqual(data, value)) return [value];
	throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
	const { max = Infinity, min = -Infinity } = meta;
	if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
	if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
	if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
	if (meta.pattern) {
		const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
		if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
	}
	checkWithinRange(data.length, meta, "string length", options);
	return [data];
});
function decimalShift(data, digits) {
	const str = data.toString();
	if (str.includes("e")) return data * Math.pow(10, digits);
	const index = str.indexOf(".");
	if (index === -1) return data * Math.pow(10, digits);
	const frac = str.slice(index + 1);
	const integer = str.slice(0, index);
	if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
	return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
	step = Math.abs(step);
	if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
	const index = step.toString().indexOf(".");
	const digits = step.toString().slice(index + 1).length;
	return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
	if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
	checkWithinRange(data, meta, "number", options);
	const { step } = meta;
	if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
	return [data];
});
Schema.extend("boolean", (data, _, options) => {
	if (typeof data === "boolean") return [data];
	throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
	let value = 0, keys = [];
	if (typeof data === "number") {
		value = data;
		for (const key in bits) if (data & bits[key]) keys.push(key);
	} else if (Array.isArray(data)) {
		keys = data;
		for (const key of keys) {
			if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
			if (key in bits) value |= bits[key];
		}
	} else throw new ValidationError(`expected number or array but got ${data}`, options);
	if (value === meta.default) return [value];
	return [value, keys];
});
Schema.extend("function", (data, _, options) => {
	if (typeof data === "function") return [data];
	throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
	if (typeof constructor === "function") {
		if (data instanceof constructor) return [data];
		throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
	} else {
		if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
		let prototype = Object.getPrototypeOf(data);
		while (prototype) {
			if (prototype.constructor?.name === constructor) return [data];
			prototype = Object.getPrototypeOf(prototype);
		}
		throw new ValidationError(`expected ${constructor} but got ${data}`, options);
	}
});
function property(data, key, schema, options) {
	try {
		const [value, adapted] = Schema.resolve(data[key], schema, {
			...options,
			path: [...options.path || [], key]
		});
		if (adapted !== void 0) data[key] = adapted;
		return value;
	} catch (e) {
		if (!options?.autofix) throw e;
		delete data[key];
		return schema.meta.volatile ? createVolatile(schema.meta.default) : schema.meta.default;
	}
}
Schema.extend("array", (data, { inner, meta }, options) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
	return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in data) {
		let rKey;
		try {
			rKey = Schema.resolve(key, sKey, options)[0];
		} catch (error) {
			if (strict) continue;
			throw error;
		}
		result[rKey] = property(data, key, inner, options);
		data[rKey] = data[key];
		if (key !== rKey) delete data[key];
	}
	return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	const result = list.map((inner, index) => property(data, index, inner, options));
	if (strict) return [result];
	result.push(...data.slice(list.length));
	return [result];
});
function merge(result, data) {
	for (const key in data) {
		if (key in result) continue;
		result[key] = data[key];
	}
}
Schema.extend("object", (data, { dict }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in dict) {
		const value = property(data, key, dict[key], options);
		if (!isNullable(value) || key in data) result[key] = value;
	}
	if (!strict) merge(result, data);
	return [result];
});
Schema.extend("union", (data, { list, toString }, options, strict) => {
	const messages = [];
	for (const inner of list) try {
		return Schema.resolve(data, inner, options, strict);
	} catch (error) {
		messages.push(error);
	}
	throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString }, options, strict) => {
	if (!list.length) return [data];
	let result;
	for (const inner of list) {
		const value = Schema.resolve(data, inner, options, true)[0];
		if (isNullable(value)) continue;
		if (isNullable(result)) result = value;
		else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		else if (typeof value === "object") merge(result ??= {}, value);
		else if (result !== value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
	}
	if (!strict && isPlainObject(data)) merge(result, data);
	return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
	const [result, adapted = data] = Schema.resolve(data, inner, options, true);
	if (preserve) return [callback(result)];
	else return [callback(result), callback(adapted)];
});
const formatters = {};
function defineMethod(name, keys, format) {
	formatters[name] = format;
	Object.assign(Schema, { [name](...args) {
		const schema = new Schema({ type: name });
		keys.forEach((key, index) => {
			switch (key) {
				case "sKey":
					schema.sKey = args[index] ?? Schema.string();
					break;
				case "inner":
					schema.inner = Schema.from(args[index]);
					break;
				case "list":
					schema.list = args[index].map(Schema.from);
					break;
				case "dict":
					schema.dict = mapValues(args[index], Schema.from);
					break;
				case "bits":
					schema.bits = {};
					for (const key in args[index]) {
						if (typeof args[index][key] !== "number") continue;
						schema.bits[key] = args[index][key];
					}
					break;
				case "callback": {
					const callback = schema.callback = args[index];
					callback["toJSON"] ||= () => callback.toString();
					break;
				}
				case "constructor": {
					const constructor = schema.constructor = args[index];
					if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
					break;
				}
				default: schema[key] = args[index];
			}
		});
		if (name === "object" || name === "dict") schema.meta.default = {};
		else if (name === "array" || name === "tuple") schema.meta.default = [];
		else if (name === "bitset") schema.meta.default = 0;
		return schema;
	} });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
	if (typeof constructor === "function") return constructor.name;
	else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
	if (Object.keys(dict).length === 0) return "{}";
	return `{ ${Object.entries(dict).map(([key, inner]) => {
		return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
	}).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
	const result = list.map(({ toString: format }) => format()).join(" | ");
	return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
	return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
	"inner",
	"callback",
	"preserve"
], ({ inner }, isInner) => inner.toString(isInner));
//#endregion
//#region ../../util/brand/lib/index.js
/**
* Duplicate-install-safe nominal primitive helpers.
*
* A brand makes structurally identical strings or numbers non-interchangeable
* at the type level: a `SessionId` cannot be passed where a `ToolCallId` is
* expected, and an event sequence cannot be passed as a log offset. Comparison,
* logging, and serialization retain the underlying primitive behavior.
*
* This package owns no concrete domain value and keeps no runtime identity or mutable
* state, so independently installed copies produce interchangeable values.
*
* @module @deepseek-ai/dsh-brand
*/
/**
* Apply a compile-time string brand without changing the value.
* @param value - string admitted by the domain that owns the target brand.
* @returns the same string with the requested compile-time brand.
*/
function brandString(value) {
	return value;
}
//#endregion
//#region ../../credentials/credentials/src/index.ts
/** Both halves of a {@link CredentialKey}; the `/` between them is what keeps it out of {@link REF_PATTERN}. */
const KEY_SEGMENT_PATTERN = /^[a-z][a-z0-9-]*$/;
/**
* Brand a scope and an id as a {@link CredentialKey}.
* @param scope - the owning plugin's registered name, such as `llm-pi-ai`.
* @param id - that plugin's own addressing unit, such as a provider route key.
* @returns the branded key.
* @throws TypeError when either segment is not a lowercase hyphenated identifier.
*/
function credentialKey(scope, id) {
	for (const segment of [scope, id]) if (!KEY_SEGMENT_PATTERN.test(segment)) throw new TypeError(`credential key segment "${segment}" must match ${String(KEY_SEGMENT_PATTERN)}`);
	return brandString(`${scope}/${id}`);
}
//#endregion
//#region src/models.ts
/** 企业授权目录与 DSH 模型适配器；员工令牌仅供 Host 使用。 */
function object(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
/** 企业资源 ID 作为模型标识，实际提供商模型名称只由服务器解析。 */
var EnterpriseModels = class extends LlmAdapter {
	config;
	storage;
	changed;
	defaultModel;
	transport;
	profiles = /* @__PURE__ */ new Map();
	models = [];
	revision = "";
	pending;
	delegate;
	constructor(config, storage, changed, defaultModel, transport = fetch) {
		super();
		this.config = config;
		this.storage = storage;
		this.changed = changed;
		this.defaultModel = defaultModel;
		this.transport = transport;
		this.delegate = new PiAiAdapter({
			profiles: () => this.profiles,
			resolveApiKey: () => this.token(),
			auth: {
				credentials: new InMemoryCredentialStore(),
				authContext: {
					env: () => Promise.resolve(void 0),
					fileExists: () => Promise.resolve(false)
				}
			}
		});
	}
	providerInfo() {
		return {
			id: "lfclaw",
			name: "企业授权模型"
		};
	}
	providerRetryPolicy() {
		return resolveRetryPolicy(this.config.modelMaxRetries === void 0 ? void 0 : {
			mode: "normal",
			maxRetries: this.config.modelMaxRetries
		}, "lfclaw.retryPolicy");
	}
	async token() {
		const grant = object(await this.storage.read());
		if (grant?.serverUrl !== this.config.serverUrl || typeof grant.token !== "string" || !grant.token) throw new LlmError("请先激活企业账号", "AUTH");
		return grant.token;
	}
	/** 更新授权目录；相同请求共享一次刷新。 @returns 目录刷新完成。 */
	refresh() {
		if (this.pending) return this.pending;
		this.pending = this.load().finally(() => {
			this.pending = void 0;
		});
		return this.pending;
	}
	async load() {
		const grant = object(await this.storage.read());
		if (grant?.serverUrl !== this.config.serverUrl || typeof grant.token !== "string") {
			this.install([]);
			return;
		}
		try {
			const response = await this.transport(`${this.config.serverUrl}/employee/me`, {
				headers: { Authorization: `Bearer ${grant.token}` },
				signal: AbortSignal.timeout(this.config.timeoutMs),
				redirect: "error"
			});
			if (!response.ok) throw new LlmError(response.status === 401 ? "员工登录已失效，请重新激活" : "无法读取企业模型授权，请检查服务连接", "AUTH", { status: response.status });
			const body = object(await response.json());
			if (!Array.isArray(body?.models)) throw new LlmError("企业模型目录响应无效", "INVALID_RESPONSE");
			const models = [];
			for (const value of body.models) {
				const model = object(value);
				if (!model || typeof model.id !== "string" || typeof model.name !== "string") throw new LlmError("企业模型目录字段无效", "INVALID_RESPONSE");
				if (model.type === "text" && model.protocol === "openai-compatible") {
					const contextWindow = model.contextWindow ?? this.config.contextWindow;
					const maxTokens = model.maxTokens ?? this.config.maxTokens;
					if (typeof contextWindow !== "number" || !Number.isSafeInteger(contextWindow) || contextWindow <= 0 || typeof maxTokens !== "number" || !Number.isSafeInteger(maxTokens) || maxTokens <= 0 || maxTokens > contextWindow) throw new LlmError("企业模型容量无效，请联系管理员检查上下文窗口和最大输出 token 数", "INVALID_RESPONSE");
					models.push({
						id: model.id,
						name: model.name,
						isDefault: model.isDefault === true,
						contextWindow,
						maxTokens
					});
				}
			}
			this.install(models);
			const preferred = models.find((model) => model.isDefault) ?? models[0];
			if (preferred) await this.defaultModel(models.map((model) => model.id), preferred.id);
		} catch (error) {
			this.install([]);
			throw error;
		}
	}
	install(models) {
		const revision = JSON.stringify(models);
		if (revision === this.revision) return;
		this.revision = revision;
		this.models = models;
		this.profiles = models.length ? resolveProfiles({ lfclaw: {
			displayName: "企业授权模型",
			api: "openai-completions",
			baseURL: `${this.config.serverUrl}/employee/v1`,
			models: models.map((model) => ({
				id: model.id,
				name: model.name,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				input: ["text"]
			})),
			compat: {
				supportsDeveloperRole: false,
				supportsStore: false
			},
			timeoutMs: this.config.timeoutMs
		} }) : /* @__PURE__ */ new Map();
		this.changed();
	}
	async listModels(provider) {
		await this.refresh();
		return this.models.length ? this.delegate.listModels(provider) : [];
	}
	async resolveModel(provider, model, signal) {
		if (!this.models.some((item) => item.id === model)) throw new LlmError("此模型尚未授权或已被移除", "MODEL_FORBIDDEN");
		return this.delegate.resolveModel(provider, model, signal);
	}
	async prepareCall(provider, model, signal) {
		await this.refresh();
		await this.resolveModel(provider, model, signal);
		return this.delegate.prepareCall(provider, model, signal);
	}
	async *stream(options) {
		yield* (await this.prepareCall(options.provider, options.model, options.signal)).stream(options);
	}
};
//#endregion
//#region src/enterprise.ts
function record(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
/**
* 校验企业地址；仅本机联调允许 HTTP。
* @param value - 部署地址。
* @returns 规范化地址。
*/
function enterpriseUrl(value) {
	const url = new URL(value);
	if (url.username || url.password || url.search || url.hash || url.protocol !== "https:" && !(url.protocol === "http:" && [
		"localhost",
		"127.0.0.1",
		"[::1]"
	].includes(url.hostname))) throw new Error("LFClaw 企业服务地址必须使用 HTTPS，本机联调可用 HTTP");
	return url.href.replace(/\/+$/, "");
}
/** 处理经过 DSH Connection 认证的激活请求。 */
var EnterpriseActivation = class {
	serverUrl;
	timeoutMs;
	storage;
	transport;
	pending = Promise.resolve();
	constructor(serverUrl, timeoutMs, storage, transport = fetch) {
		this.serverUrl = serverUrl;
		this.timeoutMs = timeoutMs;
		this.storage = storage;
		this.transport = transport;
	}
	/**
	* 顺序执行登录状态读写，避免退出与激活互相覆盖。
	* @param request - 本机请求。
	* @returns 不包含凭据的响应。
	*/
	handle(request) {
		const operation = this.pending.then(() => this.run(request));
		this.pending = operation.then(() => void 0, () => void 0);
		return operation;
	}
	async run(request) {
		try {
			const path = new URL(request.url).pathname;
			if (path.endsWith("/branding")) {
				const response = await this.transport(`${this.serverUrl}/branding`, {
					signal: AbortSignal.any([request.signal, AbortSignal.timeout(this.timeoutMs)]),
					redirect: "error"
				});
				if (!response.ok) return this.failure(response.status);
				const value = record(await response.json());
				if (typeof value?.headline !== "string" || typeof value.badge !== "string" || typeof value.showBadge !== "boolean") throw new Error("首页文案响应无效");
				return Response.json({
					headline: value.headline,
					badge: value.badge,
					showBadge: value.showBadge
				});
			}
			if (path.endsWith("/logout")) {
				await this.storage.clear();
				return Response.json({ activated: false });
			}
			let token;
			if (path.endsWith("/activate")) {
				const body = record(await request.json());
				if (typeof body?.code !== "string" || !body.code.trim() || body.code.length > 128) return Response.json({ message: "请输入有效的员工激活码" }, { status: 400 });
				const response = await this.transport(`${this.serverUrl}/employee/activate`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ code: body.code.trim() }),
					signal: AbortSignal.timeout(this.timeoutMs),
					redirect: "error"
				});
				if (!response.ok) return this.failure(response.status);
				const result = record(await response.json());
				if (typeof result?.token !== "string" || !result.token) throw new Error("激活响应无效");
				token = result.token;
			} else {
				const stored = record(await this.storage.read());
				if (stored?.serverUrl !== this.serverUrl || typeof stored.token !== "string" || !stored.token) return Response.json({ activated: false });
				token = stored.token;
			}
			const response = await this.transport(`${this.serverUrl}/employee/me`, {
				headers: { Authorization: `Bearer ${token}` },
				signal: AbortSignal.timeout(this.timeoutMs),
				redirect: "error"
			});
			if (!response.ok) return this.failure(response.status);
			const employee = record(record(await response.json())?.employee);
			if (typeof employee?.id !== "string" || typeof employee.name !== "string") throw new Error("员工响应无效");
			if (path.endsWith("/activate")) await this.storage.write({
				serverUrl: this.serverUrl,
				token
			});
			return Response.json({
				activated: true,
				employee: {
					id: employee.id,
					name: employee.name,
					departmentName: typeof employee.departmentName === "string" ? employee.departmentName : null
				}
			});
		} catch (error) {
			return Response.json({ message: error instanceof SyntaxError ? "请求或服务响应格式无效" : "无法连接企业服务或保存登录，请检查服务后重试" }, { status: 503 });
		}
	}
	failure(status) {
		return Response.json({
			activated: false,
			message: status === 401 || status === 403 ? "激活码无效、登录已失效或员工已停用，请联系管理员" : status === 429 ? "尝试次数过多，请稍后重试" : "企业服务暂不可用，请稍后重试"
		}, { status: status === 401 || status === 403 || status === 429 ? status : 503 });
	}
};
//#endregion
//#region src/index.ts
/** 企业激活插件标识。 */
const name = "lfclaw-activation";
/** 本机认证路由与凭据持久化服务。 */
const inject = [
	"connection",
	"credentials",
	"llm",
	"agentDefaultModel",
	"agents"
];
/** 启动时校验部署参数。 */
const Config = Schema.object({
	maxAutoContinuations: Schema.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(3),
	maxNoProgressContinuations: Schema.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(2),
	modelMaxRetries: Schema.number().step(1).min(0).required(),
	serverUrl: Schema.string().required(),
	timeoutMs: Schema.number().min(1).required(),
	contextWindow: Schema.number().min(1).required(),
	maxTokens: Schema.number().min(1).required(),
	refreshIntervalMs: Schema.number().min(1e3).required()
});
/**
* 注册本机受认证的激活接口，不向渲染层返回令牌。
* @param ctx - Host 上下文。
* @param config - 企业部署参数。
*/
function apply(ctx, config) {
	registerOutputContinuation(ctx, {
		...config,
		provider: "lfclaw"
	});
	const key = credentialKey(name, "employee");
	const serverUrl = enterpriseUrl(config.serverUrl);
	const storage = {
		read: async () => {
			const value = await ctx.credentials.readRecord(key);
			return value?.kind === "grant" ? value.payload : void 0;
		},
		write: async (payload) => {
			await ctx.credentials.modifyRecord(key, () => Promise.resolve({
				kind: "grant",
				payload
			}));
		},
		clear: () => ctx.credentials.deleteRecord(key)
	};
	new EnterpriseConnection(ctx, serverUrl, config.timeoutMs, storage);
	const activation = new EnterpriseActivation(serverUrl, config.timeoutMs, storage);
	const models = new EnterpriseModels({
		modelMaxRetries: config.modelMaxRetries,
		timeoutMs: config.timeoutMs,
		contextWindow: config.contextWindow,
		maxTokens: config.maxTokens,
		serverUrl
	}, storage, () => {
		ctx.emit("llm/adapters-updated");
	}, async (ids, preferred) => {
		const current = ctx.agentDefaultModel.currentSelection();
		if (current.provider !== "lfclaw" || !ids.includes(current.model)) await ctx.agentDefaultModel.saveSelection({
			provider: "lfclaw",
			model: preferred
		});
	});
	ctx.effect(() => ctx.llm.registerAdapter(["lfclaw"], models), "lfclaw: enterprise models");
	ctx.effect(() => {
		const timer = setInterval(() => {
			models.refresh().catch(() => {});
		}, config.refreshIntervalMs);
		return () => {
			clearInterval(timer);
		};
	}, "lfclaw: model authorization refresh");
	for (const operation of [
		"status",
		"branding",
		"activate",
		"logout"
	]) ctx.effect(() => ctx.connection.fetch.register({
		path: `/api/lfclaw/${operation}`,
		methods: operation === "status" || operation === "branding" ? ["GET"] : ["POST"],
		requestBody: "buffered",
		fetch: (request) => activation.handle(request)
	}), `lfclaw: ${operation}`);
}
//#endregion
export { Config, EnterpriseConnection, apply, inject, name };
