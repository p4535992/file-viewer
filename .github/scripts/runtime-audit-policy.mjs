import assert from 'node:assert/strict'

const vue2Advisory = 'https://github.com/advisories/GHSA-5j4c-8p2g-v4jx'
const legacyHosts = { 'vue2.6': '2.6.14', 'vue2.7': '2.7.16' }

// This mirrors the existing documented pnpm policy, not a severity downgrade.
// Keep the normal npm report and permit only this exact legacy host finding.
export function assessRuntimeAudit(report, { framework, vueVersion }) {
  assert.ok(report && !report.error && report.metadata?.vulnerabilities && report.vulnerabilities)
  const counts = report.metadata.vulnerabilities
  const findings = Object.entries(report.vulnerabilities)
  if (findings.length === 0 && counts.total === 0)
    return { status: 'passed', retainedExceptions: [] }
  const host = report.vulnerabilities.vue
  const wrappers = new Set([`@file-viewer/${framework}`, `@file-viewer/${framework}-full`])
  const reachesHost = (name, seen = new Set()) => {
    if (name === 'vue') return true
    if (!wrappers.has(name) || seen.has(name)) return false
    seen.add(name)
    const finding = report.vulnerabilities[name]
    return (
      finding?.severity === 'low' &&
      finding.via?.length > 0 &&
      finding.via.every((via) => typeof via === 'string' && reachesHost(via, new Set(seen)))
    )
  }
  const permitted =
    legacyHosts[framework] === vueVersion &&
    host?.severity === 'low' &&
    host.via?.length === 1 &&
    host.via[0]?.url === vue2Advisory &&
    host.via[0]?.severity === 'low' &&
    findings.every(([name, finding]) => finding.severity === 'low' && reachesHost(name)) &&
    counts.low === findings.length &&
    counts.total === findings.length &&
    ['info', 'moderate', 'high', 'critical'].every((key) => counts[key] === 0)
  return permitted
    ? {
        status: 'passed-with-existing-vue2-host-exemption',
        retainedExceptions: [
          {
            packageName: 'vue',
            version: vueVersion,
            severity: 'low',
            advisory: vue2Advisory,
            propagatedPackages: findings.map(([name]) => name).filter((name) => name !== 'vue'),
            reason:
              'Existing Vue 2 host-template-compiler policy; no patched Vue 2 exists. Only exact compatibility wrappers propagating that same host finding are included.'
          }
        ]
      }
    : {
        status: 'failed',
        retainedExceptions: [],
        unexpectedVulnerabilities: findings.map(([name, finding]) => ({
          name,
          severity: finding.severity
        }))
      }
}
