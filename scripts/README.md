# Scripts and test isolation rules

## Smart-broadcast / message generation tests

Any script that exercises smart-broadcast generation, prompt injection checks, or message generation must:

1. Create a fresh organization and a fresh agent inside that organization.
2. Create test leads only inside that isolated organization.
3. Never reuse an existing production org_id or agent_id, even if the lead IDs are fake.
4. Prefer the shared helper in [scripts/smart-broadcast-test-utils.ts](scripts/smart-broadcast-test-utils.ts) so the isolation rule is enforced consistently.

These scripts are expected to be safe for local debugging and should not mix test data with real customer data.
# Smart broadcast and generation test scripts

Все скрипты под этой папкой, которые тестируют smart-broadcast, генерацию сообщений или инъекции, обязаны работать только с полностью изолированной тестовой средой.

Правила:
- Каждый такой скрипт должен создавать собственную изолированную организацию и агента в БД.
- Нельзя использовать существующий org_id/agent_id реальной компании, даже если тестовые лиды выглядят как фейки.
- Тестовые лиды должны создаваться только внутри этой изолированной организации.
- Для новых скриптов используйте helpers/utility из scripts/smart-broadcast-test-utils.ts.

Если нужен запуск против реальной организации, это должно быть явным исключением и не частью обычных тестов/скриптов.
