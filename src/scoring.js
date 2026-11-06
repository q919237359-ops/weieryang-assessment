/** Generic validation/scoring only. Private values are fetched after owner authentication. */
export class APIError extends Error {
    status;
    constructor(status, message) { super(message); this.status = status; }
}
export function object(value, label = "数据") {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new APIError(400, `${label}格式不正确`);
    return value;
}
export function text(value, label, max, min = 1) {
    if (typeof value !== "string" || value.trim().length < min || value.trim().length > max)
        throw new APIError(400, `${label}需为 ${min}–${max} 个字符`);
    return value.trim();
}
export function integer(value, label, min, max) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
        throw new APIError(400, `${label}需为 ${min}–${max} 的整数`);
    return value;
}
function id(value, label, max) {
    const result = text(value, label, max);
    if (!/^[A-Za-z0-9_-]+$/.test(result) || ["__proto__", "constructor", "prototype"].includes(result))
        throw new APIError(400, `${label}包含无效字符`);
    return result;
}
export function validateConfig(value) {
    const data = object(value, "设置");
    const cfg = {
        company: text(data.company, "公司名称", 100), title: text(data.title, "测评标题", 150),
        position: text(data.position, "岗位名称", 80), intro: text(data.intro, "测评说明", 2000, 0),
        estimated_minutes: text(data.estimated_minutes, "预计用时", 40),
        pass_score: integer(data.pass_score, "参考分数线", 0, 100), warning_limit: integer(data.warning_limit, "切屏提醒次数", 1, 100), questions: [],
    };
    if (!Array.isArray(data.questions) || !data.questions.length || data.questions.length > 100)
        throw new APIError(400, "题库应有 1–100 道题");
    const raw = data.questions.map(q => object(q, "题目"));
    const weighted = raw.some(q => Object.hasOwn(q, "scoring"));
    if (weighted && raw.some(q => !Object.hasOwn(q, "scoring")))
        throw new APIError(400, "新版评分题库不可混用旧版参考答案规则");
    if (weighted || Object.hasOwn(data, "rubric_version"))
        cfg.rubric_version = text(data.rubric_version, "评分规则版本", 100);
    const seen = new Set();
    cfg.questions = raw.map((q, index) => {
        const qid = id(q.id, "题目 ID", 60);
        if (seen.has(qid))
            throw new APIError(400, "题目 ID 不可重复");
        seen.add(qid);
        const kind = q.type ?? "single";
        if (kind !== "single" && kind !== "rank")
            throw new APIError(400, "题型应为 single 或 rank");
        if (!Array.isArray(q.options) || q.options.length < (kind === "rank" ? 3 : 2) || q.options.length > (kind === "rank" ? 10 : 8))
            throw new APIError(400, `第 ${index + 1} 题选项数量不正确`);
        const ids = new Set();
        const options = q.options.map(option => {
            const item = object(option, "选项");
            const oid = id(item.id, "选项 ID", 20);
            if (ids.has(oid))
                throw new APIError(400, "同一道题的选项 ID 不可重复");
            ids.add(oid);
            return { id: oid, text: text(item.text, "选项文字", 1500) };
        });
        const item = { id: qid, type: kind, category: text(q.category, "分类", 80), text: text(q.text, "题目文字", 2500), options, explanation: text(q.explanation ?? "", "参考说明", 2500, 0) };
        if (kind === "rank")
            item.rank_count = integer(q.rank_count ?? 3, "排序选择数", 2, options.length);
        if (weighted) {
            const scoring = object(q.scoring, "评分规则");
            const mode = scoring.mode;
            if (mode !== "weighted" && mode !== "profile")
                throw new APIError(400, "评分模式无效");
            const max = integer(scoring.max, "题目满分", 0, 100);
            const rawScores = object(scoring.option_scores, "选项分值");
            const rawReviews = object(scoring.review_options ?? {}, "复核说明");
            const scores = {};
            const reviews = {};
            for (const [key, val] of Object.entries(rawReviews)) {
                if (!ids.has(key))
                    throw new APIError(400, "复核说明包含未知选项");
                reviews[key] = text(val, "复核说明", 1500);
            }
            if (mode === "weighted") {
                if (kind !== "single" || !max || Object.keys(rawScores).length !== ids.size || Object.keys(rawScores).some(k => !ids.has(k)))
                    throw new APIError(400, "计分题需为单选、满分大于零，并为所有选项设置分值");
                for (const [key, val] of Object.entries(rawScores))
                    scores[key] = integer(val, "选项分值", 0, max);
                if (!Object.values(scores).includes(max))
                    throw new APIError(400, "计分题至少有一个选项达到本题满分");
            }
            else if (max !== 0 || Object.keys(rawScores).length || Object.keys(reviews).length)
                throw new APIError(400, "沟通项满分须为零，不设置选项分值或风险判定");
            item.scoring = { mode, max, option_scores: scores, review_options: reviews };
            item.follow_up = text(q.follow_up ?? "", "面试追问", 2500, 0);
        }
        else {
            const correct = q.correct;
            if (kind === "single") {
                if (typeof correct !== "string" || !ids.has(correct))
                    throw new APIError(400, "参考答案无效");
            }
            else if (!Array.isArray(correct) || correct.length !== item.rank_count || correct.some(v => typeof v !== "string" || !ids.has(v)) || new Set(correct).size !== correct.length)
                throw new APIError(400, "排序参考答案无效");
            item.correct = correct;
        }
        return item;
    });
    if (weighted && cfg.questions.reduce((n, q) => n + q.scoring.max, 0) !== 100)
        throw new APIError(400, "所有计分题满分合计必须为 100 分");
    return cfg;
}
export function validateAnswers(value, questions, complete = false) {
    const data = object(value, "答案");
    const lookup = new Map(questions.map(q => [q.id, q]));
    const result = {};
    for (const [key, answer] of Object.entries(data)) {
        const q = lookup.get(key);
        if (!q)
            throw new APIError(400, "答案包含未知题目");
        const options = new Set(q.options.map(o => o.id));
        if (q.type === "rank") {
            if (!Array.isArray(answer) || answer.length > q.rank_count || answer.some(a => typeof a !== "string" || !options.has(a)) || new Set(answer).size !== answer.length)
                throw new APIError(400, "排序答案包含无效或重复的选项");
            if (complete && answer.length !== q.rank_count)
                throw new APIError(400, "请完成全部题目后提交");
        }
        else if (typeof answer !== "string" || !options.has(answer))
            throw new APIError(400, "单选答案无效");
        result[key] = answer;
    }
    if (complete && Object.keys(result).length !== questions.length)
        throw new APIError(400, "请完成全部题目后提交");
    return result;
}
export function gradeAttempt(questions, answers) {
    if (!questions.some(q => q.scoring))
        return { score: Math.round(questions.filter(q => JSON.stringify(answers[q.id]) === JSON.stringify(q.correct)).length * 100 / questions.length) };
    const grade = { score: 0, question_scores: [], dimension_scores: [], preferences: [], review_flags: [] };
    const dimensions = new Map();
    for (const q of questions) {
        const scoring = q.scoring;
        const chosen = answers[q.id];
        let score = null;
        let reason = "";
        if (scoring.mode === "weighted") {
            score = scoring.option_scores[chosen];
            grade.score += score;
            const dimension = dimensions.get(q.category) ?? { category: q.category, score: 0, max: 0 };
            dimension.score += score;
            dimension.max += scoring.max;
            dimensions.set(q.category, dimension);
            reason = scoring.review_options[chosen] ?? "";
            if (reason)
                grade.review_flags.push({ id: q.id, message: reason });
        }
        else {
            const ids = Array.isArray(chosen) ? chosen : [chosen];
            grade.preferences.push({ id: q.id, category: q.category, choices: ids.map((oid, i) => ({ id: oid, text: q.options.find(o => o.id === oid).text, weight: ids.length - i })) });
        }
        grade.question_scores.push({ id: q.id, mode: scoring.mode, chosen, score, max: scoring.max, review_reason: reason });
    }
    grade.dimension_scores = [...dimensions.values()];
    return grade;
}
export function publicQuestions(questions) {
    return questions.map(q => ({ id: q.id, type: q.type, category: q.category, text: q.text, options: q.options.map(o => ({ id: o.id, text: o.text })), ...(q.rank_count === undefined ? {} : { rank_count: q.rank_count }) }));
}
export function publicConfig(c) {
    return { company: c.company, title: c.title, position: c.position, intro: c.intro, estimated_minutes: c.estimated_minutes, warning_limit: c.warning_limit, questions: publicQuestions(c.questions) };
}
export function publicAttempt(a) {
    return { id: a.id, name: a.name, position: a.position, status: a.status, created_at: a.created_at, submitted_at: a.submitted_at, answers: a.answers, warning_count: a.warning_count, elapsed_seconds: a.elapsed_seconds, question_count: a.question_count, questions: publicQuestions(a.questions) };
}
export function summary(a) {
    return { id: a.id, name: a.name, position: a.position, status: a.status, created_at: a.created_at, submitted_at: a.submitted_at, warning_count: a.warning_count, elapsed_seconds: a.elapsed_seconds, question_count: a.question_count, score: a.score, passed: a.passed, notes: a.notes, rubric_version: a.rubric_version, review_count: a.review_flags?.length ?? 0 };
}
function csvCell(value) {
    let str = value === null || value === undefined ? "" : String(value);
    if (/^[\s]*[=+@\-\t\r\n]/.test(str))
        str = "'" + str;
    return '"' + str.replace(/"/g, '""') + '"';
}
export function exportCSV(attempts) {
    const header = ["答卷编号", "姓名", "岗位", "状态", "参考得分", "参考分数线", "达到参考线", "切屏次数", "用时秒", "开始时间", "提交时间", "HR复核备注", "评分规则版本", "重点复核项"];
    const rows = attempts.map(a => [a.id, a.name, a.position, a.status === "submitted" ? "已提交" : "作答中", a.score, a.pass_score, a.passed === null ? "" : a.passed ? "是" : "否", a.warning_count, a.elapsed_seconds, a.created_at, a.submitted_at, a.notes, a.rubric_version ?? "legacy-exact-v1", (a.review_flags ?? []).map(f => `${f.id}: ${f.message}`).join("; ")]);
    return "\ufeff" + [header, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
