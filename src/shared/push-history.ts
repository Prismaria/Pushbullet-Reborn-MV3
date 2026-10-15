import type { Push } from './models'

/** Match a device's received pushes and, optionally, its sent pushes. */
export function pushMatchesDevice(push: Push, deviceIden: string, showSentPushes = true): boolean {
  const isDevicePush = !push.clientIden && (push.direction === 'self'
    || (!push.direction && !push.email && !push.channelTag && !push.channelIden))
  const sentFromDevice = showSentPushes && isDevicePush && push.sourceDeviceIden === deviceIden
  if (push.targetDeviceIden) return push.targetDeviceIden === deviceIden || sentFromDevice
  return sentFromDevice || push.deviceIden === deviceIden
    || (isDevicePush && push.streamDeviceIden === deviceIden && (showSentPushes || push.sourceDeviceIden !== deviceIden))
}
