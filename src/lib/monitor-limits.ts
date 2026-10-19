// No imports: shared by combine-monitor.ts and guidance-lines.ts, and bundled into Netlify functions.

/**
 * The longest name the combine display takes for a grower, farm, field, tag,
 * vehicle or guidance line. 18 is the IntelliView III guide's figure (v26,
 * 2011); the IntelliView IV may allow more. If Sam finds his display takes
 * longer names, change it here and nowhere else: every shortening rule, file
 * name, attribute width and on-screen note follows it.
 */
export const MONITOR_NAME_MAX = 18
