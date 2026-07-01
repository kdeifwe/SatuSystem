"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_HANDOFF_CONFIG = void 0;
exports.normalizeHandoffConfig = normalizeHandoffConfig;
exports.buildHandoffPromptSection = buildHandoffPromptSection;
exports.injectHandoffSection = injectHandoffSection;
exports.DEFAULT_HANDOFF_CONFIG = {
    enabled: true,
    triggers: {
        explicit_request: true,
        anger_complaint: true,
        no_answer_after_two_searches: true,
        asks_if_bot: false,
    },
    client_message: 'Подключаю сотрудника, он уже видит наш диалог',
    operator_message: 'Новый диалог требует внимания',
};
function normalizeHandoffConfig(value) {
    const source = (value && typeof value === 'object' ? value : {});
    const triggersSource = (source.triggers && typeof source.triggers === 'object' ? source.triggers : {});
    return {
        enabled: Boolean(source.enabled ?? true),
        triggers: {
            explicit_request: Boolean(triggersSource.explicit_request ?? true),
            anger_complaint: Boolean(triggersSource.anger_complaint ?? true),
            no_answer_after_two_searches: Boolean(triggersSource.no_answer_after_two_searches ?? true),
            asks_if_bot: Boolean(triggersSource.asks_if_bot ?? false),
        },
        client_message: String(source.client_message ?? exports.DEFAULT_HANDOFF_CONFIG.client_message),
        operator_message: String(source.operator_message ?? exports.DEFAULT_HANDOFF_CONFIG.operator_message),
    };
}
function buildHandoffPromptSection(config) {
    const normalized = normalizeHandoffConfig(config);
    const bullets = [];
    if (!normalized.enabled) {
        return `<handoff_triggers>\nАвто-передача отключена. Не вызывай redirectToOperator автоматически.\n</handoff_triggers>`;
    }
    if (normalized.triggers.explicit_request) {
        bullets.push('- Клиент явно просит человека или оператора');
    }
    if (normalized.triggers.anger_complaint) {
        bullets.push('- Клиент выражает злость, угрозы или жалоба на компанию');
    }
    bullets.push('- Вопрос требует действий вне твоих полномочий (возврат денег, договор, юридика)');
    if (normalized.triggers.no_answer_after_two_searches) {
        bullets.push('- Агент не нашёл ответ 2 раза подряд');
    }
    if (normalized.triggers.asks_if_bot) {
        bullets.push('- клиент спрашивает "ты бот?"');
    }
    const finalBullets = bullets.length > 0 ? bullets.join('\n') : '- авто-передача включена, но не активировано ни одного триггера';
    return `<handoff_triggers>\nНемедленно вызови redirectToOperator если:\n${finalBullets}\n\nПри вызове — сначала отправь клиенту сообщение: \"${normalized.client_message}\", потом вызывай redirectToOperator с причиной передачи.\nПередай оператору это уведомление: \"${normalized.operator_message}\"\n</handoff_triggers>`;
}
function injectHandoffSection(systemPrompt, value) {
    const normalized = normalizeHandoffConfig(value);
    const section = buildHandoffPromptSection(normalized);
    const regex = /<handoff_triggers>[\s\S]*?<\/handoff_triggers>/;
    if (regex.test(systemPrompt)) {
        return systemPrompt.replace(regex, section);
    }
    return `${systemPrompt}\n\n${section}`;
}
