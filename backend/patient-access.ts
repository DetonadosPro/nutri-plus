import { db } from "./db";
import type { AuthUser } from "./auth";

export async function patientAccess(user: AuthUser, patientId?: number) {
  if (user.role === "admin") return null;
  if (user.role === "patient") {
    const patient = await db
      .prepare("SELECT * FROM patients WHERE user_id = ?")
      .get<Record<string, any>>(user.id);
    if (!patient || (patientId && Number(patient.id) !== patientId)) return null;
    return patient;
  }
  if (!patientId) {
    return (
      (await db
        .prepare("SELECT * FROM patients WHERE user_id = ? AND nutritionist_user_id = ?")
        .get<Record<string, any>>(user.id, user.id)) ?? null
    );
  }
  return (
    (await db
      .prepare("SELECT * FROM patients WHERE id = ? AND nutritionist_user_id = ?")
      .get<Record<string, any>>(patientId, user.id)) ?? null
  );
}
