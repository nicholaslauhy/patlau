import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import TelegramBot from 'node-telegram-bot-api'
import cron from 'node-cron'
import { authorizeTelegramSender } from '../../lib/telegram-auth'
import { recordTelegramDelivery } from '../../lib/telegram-audit'
import { safeAuditError, writeAuditEvent } from '../../lib/audit-server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!, { polling: false })

// Function to send payment reminders
async function sendPaymentReminders(request?: Request) {
  try {
    // Get all unpaid students
    const { data: unpaidStudents, error } = await supabase
      .from('students')
      .select('*')
      .eq('paid', false)

    if (error) throw error

    if (!unpaidStudents || unpaidStudents.length === 0) {
      console.log('No unpaid students found')
      await writeAuditEvent({
        request,
        eventKind: 'activity',
        category: 'payments',
        eventType: 'telegram.payment_reminders.completed',
        action: 'send_payment_reminders',
        outcome: 'success',
        summary: 'Payment reminder check completed with no unpaid students',
        actorSource: request ? 'authenticated_or_cron_api' : 'scheduled_job',
        targetTable: 'telegram',
        targetLabel: 'payment reminders',
        metadata: { student_count: 0 },
      })
      return 0
    }

    // Send reminder for each unpaid student
    for (const student of unpaidStudents) {
      const message = `💰 Payment Reminder 💰\n\n` +
        `Student: ${student.student_name}\n` +
        `Total Amount Due: $${student.price * student.total_weeks}\n` +
        `(For ${student.total_weeks} weeks of lessons)\n` +
        `Please remind them to pay the full amount.`

      // Send to all configured chat IDs
      const chatIds = process.env.TELEGRAM_CHAT_IDS?.split(',') || []
      for (const chatId of chatIds) {
        await bot.sendMessage(chatId.trim(), message)
      }
    }

    console.log(`Sent reminders for ${unpaidStudents.length} unpaid students`)
    await writeAuditEvent({
      request,
      eventKind: 'activity',
      category: 'payments',
      eventType: 'telegram.payment_reminders.completed',
      action: 'send_payment_reminders',
      outcome: 'success',
      summary: `Sent payment reminders for ${unpaidStudents.length} unpaid students`,
      actorSource: request ? 'authenticated_or_cron_api' : 'scheduled_job',
      targetTable: 'telegram',
      targetLabel: 'payment reminders',
      metadata: { student_count: unpaidStudents.length },
    })
    return unpaidStudents.length
  } catch (error) {
    console.error('Error sending payment reminders:', error)
    await writeAuditEvent({
      request,
      eventKind: 'system',
      category: 'payments',
      eventType: 'telegram.payment_reminders.failed',
      action: 'send_payment_reminders',
      outcome: 'failure',
      summary: 'Payment reminder delivery failed',
      actorSource: request ? 'authenticated_or_cron_api' : 'scheduled_job',
      targetTable: 'telegram',
      targetLabel: 'payment reminders',
      metadata: { error: safeAuditError(error) },
    })
    throw error
  }
}

// Set up weekly cron job (runs every Monday at 9am)
cron.schedule('0 9 * * 1', async () => {
  console.log('Running weekly payment reminder check...')
  await sendPaymentReminders().catch(() => undefined)
})

export async function POST(request: Request) {
  try {
    const authorization = await authorizeTelegramSender(request, ['superuser'], 'payment_reminder')
    if ('status' in authorization) {
      return NextResponse.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
        { status: authorization.status },
      )
    }

    const { message } = await request.json();
    
    if (!message) {
      return NextResponse.json(
        { message: 'Message content is required' },
        { status: 400 }
      );
    }

    const chatIds = process.env.TELEGRAM_CHAT_IDS?.split(',') || [];
    for (const chatId of chatIds) {
      await bot.sendMessage(chatId.trim(), message);
    }

    await recordTelegramDelivery({
      request,
      programme: 'payment_reminder',
      category: 'payments',
      outcome: 'success',
      targetLabel: `${chatIds.length} configured chats`,
    })

    return NextResponse.json(
      { message: 'Notification sent successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in POST handler:', error);
    await recordTelegramDelivery({
      request,
      programme: 'payment_reminder',
      category: 'payments',
      outcome: 'failure',
      error,
    })
    return NextResponse.json(
      { message: 'Failed to send notification' },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const authorization = await authorizeTelegramSender(request, ['superuser'], 'payment_reminder')
    if ('status' in authorization) {
      return NextResponse.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
        { status: authorization.status },
      )
    }

    await sendPaymentReminders(request);
    return NextResponse.json(
      { message: 'Payment reminders sent successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in GET handler:', error);
    return NextResponse.json(
      { message: 'Failed to send payment reminders' },
      { status: 500 }
    );
  }
}
