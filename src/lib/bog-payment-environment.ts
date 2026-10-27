const BOG_PRODUCTION_HOSTS = new Set(['cityroute.ge', 'www.cityroute.ge'])

export function isBogLivePaymentSite(
  hostname = window.location.hostname,
  deploymentEnvironment = import.meta.env.VERCEL_ENV,
): boolean {
  return deploymentEnvironment === 'production' && BOG_PRODUCTION_HOSTS.has(hostname)
}
