const UNSAFE =
  /\b(kill|murder|blood|gore|weapon|suicide|sex|naked|drugs?|terrorist|hate|torture|scary|horror|nightmare)\b/i;
export const bedtimeRules =
  "No violence, horror, frightening imagery, mature themes, dangerous instructions, or unsafe behavior. End calmly and positively. Never include personal information other than the child's first name.";
export function safeProfile(x = {}) {
  return {
    childName: String(x.childName || "Your child")
      .trim()
      .slice(0, 40),
    age: Math.max(2, Math.min(12, Number(x.age) || 6)),
    themes: String(x.themes || "moonlight, friendship, gentle animals")
      .trim()
      .slice(0, 200),
    email: String(x.email || "")
      .trim()
      .slice(0, 160),
    timezone: x.timezone || "Europe/Stockholm",
    bedtime: /^([01]\\d|2[0-3]):[0-5]\\d$/.test(String(x.bedtime || ""))
      ? String(x.bedtime)
      : "20:00",
  };
}
export function isSafeStory(x) {
  return Boolean(
    x &&
    typeof x.title === "string" &&
    typeof x.body === "string" &&
    x.body.length >= 120 &&
    x.body.length <= 12000 &&
    !UNSAFE.test(x.title + " " + x.body),
  );
}
