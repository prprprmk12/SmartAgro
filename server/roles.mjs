// Existing users predate role-based access. Preserve accounts while ensuring one owner per company.
export async function migrateRoles(users) {
  const existing = await users.find({}).sort({ createdAt: 1, _id: 1 }).toArray()
  const ownerCompanies = new Set(existing.filter((user) => user.role === 'owner').map((user) => user.companyId.toString()))
  for (const user of existing) {
    if (user.role === 'owner' || user.role === 'agronomist') continue
    const companyId = user.companyId.toString()
    const role = ownerCompanies.has(companyId) ? 'agronomist' : 'owner'
    await users.updateOne({ _id: user._id }, { $set: { role } })
    if (role === 'owner') ownerCompanies.add(companyId)
  }
}
