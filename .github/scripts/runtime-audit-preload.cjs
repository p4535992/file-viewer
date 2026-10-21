require('./runtime-audit-scope.cjs').installAuditScopeGuard(
  process.env.FILE_VIEWER_AUDIT_EXPECTED_PAYLOAD_SHA256
)
