"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = require("node:assert/strict");
const node_test_1 = require("node:test");
const handoff_1 = require("../lib/server/ai/handoff");
(0, node_test_1.default)('buildHandoffPromptSection includes enabled triggers and messages', () => {
    const config = (0, handoff_1.normalizeHandoffConfig)({
        enabled: true,
        triggers: {
            explicit_request: true,
            anger_complaint: false,
            no_answer_after_two_searches: true,
            asks_if_bot: false,
        },
        client_message: 'Подключаю сотрудника, он уже видит наш диалог',
        operator_message: 'Новый диалог требует внимания',
    });
    const section = (0, handoff_1.buildHandoffPromptSection)(config);
    strict_1.default.match(section, /<handoff_triggers>/);
    strict_1.default.match(section, /Клиент явно просит человека или оператора/);
    strict_1.default.match(section, /Агент не нашёл ответ 2 раза подряд/);
    strict_1.default.doesNotMatch(section, /Злость, угрозы или жалоба/);
    strict_1.default.match(section, /Подключаю сотрудника, он уже видит наш диалог/);
    strict_1.default.match(section, /Новый диалог требует внимания/);
});
