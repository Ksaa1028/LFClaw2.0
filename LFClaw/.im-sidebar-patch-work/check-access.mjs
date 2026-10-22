import { decideAccess } from './modified/lib/engine/access.js'

if (decideAccess({ kind: 'group', addressed: true, userAllowed: true }) !== 'ignore') {
  throw new Error('Group messages must be ignored')
}
if (decideAccess({ kind: 'dm', userAllowed: true }) !== 'allow') {
  throw new Error('Approved private messages must be allowed')
}
