'use server'

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

// === ЛОГИРОВАНИЕ ===
async function logAction(userId: number | null, action: string, details?: any) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        details: details ? JSON.stringify(details) : null
      }
    });
  } catch (e) {
    console.error("❌ Ошибка AuditLog:", e);
  }
}

// === ВХОД / ВЫХОД ===
export async function loginUser(formData: FormData) {
  const login = formData.get('login') as string;
  const password = formData.get('password') as string;

  const reg = await prisma.registration.findUnique({
    where: { login },
    include: { user: true }
  });

  if (!reg || reg.password !== password) redirect('/login?error=1');
  if (reg.isBlocked) redirect('/login?error=blocked');

  const cookieStore = await cookies();
  cookieStore.set('userId', reg.userId.toString(), { maxAge: 60 * 60 * 24, path: '/' });
  cookieStore.set('roleId', reg.user.roleId.toString(), { maxAge: 60 * 60 * 24, path: '/' });

  await logAction(reg.userId, 'Вход в систему');
  
  if (reg.user.roleId === 3) redirect('/?section=documents');
  else redirect('/dashboard');
}

export async function logoutUser() {
  const cookieStore = await cookies();
  cookieStore.delete('userId');
  cookieStore.delete('roleId');
  redirect('/login');
}

// === ПОЛЬЗОВАТЕЛИ ===
export async function createUser(formData: FormData) {
  try {
    const fullName = formData.get('fullName') as string;
    const login = formData.get('login') as string;
    const password = formData.get('password') as string;
    const roleId = parseInt(formData.get('roleId') as string);
    const deptId = formData.get('departmentId');
    const departmentId = deptId ? parseInt(deptId as string) : null;

    await prisma.user.create({
      data: {
        fullName,
        position: 'Сотрудник',
        roleId,
        departmentId,
        registration: { create: { login, password } }
      }
    });
    revalidatePath('/');
  } catch (e) { console.error(e); }
  redirect('/?section=users');
}

export async function updateUser(formData: FormData) {
  try {
    const id = parseInt(formData.get('id') as string);
    const fullName = formData.get('fullName') as string;
    const roleId = parseInt(formData.get('roleId') as string);
    const password = formData.get('password') as string;

    await prisma.user.update({
      where: { id },
      data: { fullName, roleId }
    });

    if (password) {
      await prisma.registration.update({
        where: { userId: id },
        data: { password }
      });
    }
    revalidatePath('/');
  } catch (e) { console.error(e); }
  redirect('/?section=users');
}

export async function deleteUser(formData: FormData) {
  const id = parseInt(formData.get('id') as string);
  await prisma.user.delete({ where: { id } });
  revalidatePath('/');
}

export async function toggleBlockUser(formData: FormData) {
  // Исправили получение ID, чтобы работало с кнопками из page.tsx
  const idStr = formData.get('id') || formData.get('userId');
  const userId = parseInt(idStr as string);
  
  const reg = await prisma.registration.findUnique({ where: { userId } });
  if (reg) {
    await prisma.registration.update({
      where: { userId },
      data: { isBlocked: !reg.isBlocked }
    });
  }
  revalidatePath('/');
}

// === ОТДЕЛЫ ===
export async function createDepartment(formData: FormData) {
  try {
    const name = formData.get('departmentName') as string;
    await prisma.department.create({ data: { departmentName: name } });
    revalidatePath('/');
  } catch (e) { console.error(e); }
  redirect('/?section=departments');
}

export async function deleteDepartment(formData: FormData) {
  const id = parseInt(formData.get('id') as string);
  await prisma.department.delete({ where: { id } });
  revalidatePath('/');
}

// === ДОКУМЕНТЫ (С ИСПРАВЛЕННОЙ ЗАГРУЗКОЙ ФАЙЛОВ) ===
export async function createDocument(formData: FormData) {
  try {
    const cookieStore = await cookies();
    const authorId = parseInt(cookieStore.get('userId')?.value || '1');
    
    // Получаем все данные из формы
    const title = formData.get('title') as string;
    const taskDescription = formData.get('taskDescription') as string;
    const priority = formData.get('priority') as string || 'medium';
    const deadlineStr = formData.get('deadline') as string;
    const assignedToRaw = formData.get('assignedTo');
    const assignedTo = assignedToRaw ? parseInt(assignedToRaw as string) : null;
    
    const file = formData.get('file') as File | null;

    let fileData = null;
    let fileName = null;
    let fileType = null;

    // Переводим файл в Base64 для сохранения в БД
    if (file && file.size > 0) {
      fileName = file.name;
      fileType = file.type || 'application/octet-stream';
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      fileData = `data:${fileType};base64,${buffer.toString('base64')}`;
    }

    await prisma.document.create({
      data: { 
        title, 
        taskDescription,
        priority,
        deadline: deadlineStr ? new Date(deadlineStr) : null,
        userId: authorId, 
        statusId: 1, // Статус: Новое
        fileName,
        fileType,
        fileData,
        assignedTo 
      }
    });

    await logAction(authorId, 'Создание документа', `Создан документ: ${title} ${fileName ? '(с файлом)' : ''}`);
    revalidatePath('/');
  } catch (e) { console.error(e); }
  redirect('/?section=documents');
}

export async function deleteDocument(formData: FormData) {
  const id = parseInt(formData.get('id') as string);
  await prisma.document.delete({ where: { id } });
  revalidatePath('/');
}

export async function updateDocumentStatus(formData: FormData) {
  const id = parseInt(formData.get('id') as string);
  const statusId = parseInt(formData.get('statusId') as string);
  await prisma.document.update({
    where: { id },
    data: { statusId, completedAt: statusId === 4 ? new Date() : null }
  });
  revalidatePath('/');
}

export async function submitDocumentResult(formData: FormData) {
  try {
    const id = parseInt(formData.get('id') as string);
    const resultText = formData.get('resultText') as string;
    await prisma.document.update({
      where: { id },
      data: { resultText, statusId: 3 }
    });
    revalidatePath('/');
  } catch (e) { console.error(e); }
  redirect('/dashboard');
}

// === ПАРОЛИ ===
export async function requestPasswordReset(formData: FormData) {
  const login = formData.get('login') as string;
  await prisma.passwordResetRequest.create({ data: { login, status: 'PENDING' } });
  revalidatePath('/login');
}

export async function resolvePasswordReset(formData: FormData) {
  // Исправили получение ID запроса
  const idStr = formData.get('requestId') || formData.get('id');
  const id = parseInt(idStr as string);
  
  const request = await prisma.passwordResetRequest.findUnique({ where: { id } });
  if (request) {
    // Сбрасываем пароль на стандартный "123"
    await prisma.registration.update({
      where: { login: request.login },
      data: { password: '123' }
    });
    // Удаляем запрос
    await prisma.passwordResetRequest.delete({ where: { id } });
  }
  revalidatePath('/');
}
