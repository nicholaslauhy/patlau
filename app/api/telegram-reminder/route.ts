import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import TelegramBot from 'node-telegram-bot-api'
import cron from 'node-cron'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!, { polling: false })

// Function to send payment reminders
async function sendPaymentReminders() {
  try {
    // Get all unpaid students
    const { data: unpaidStudents, error } = await supabase
      .from('students')
      .select('*')
      .eq('paid', false)

    if (error) throw error

    if (!unpaidStudents || unpaidStudents.length === 0) {
      console.log('No unpaid students found')
      return
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
  } catch (error) {
    console.error('Error sending payment reminders:', error)
  }
}

// Set up weekly cron job (runs every Monday at 9am)
cron.schedule('0 9 * * 1', () => {
  console.log('Running weekly payment reminder check...')
  sendPaymentReminders()
})

export async function POST(request: Request) {
  try {
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

    return NextResponse.json(
      { message: 'Notification sent successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in POST handler:', error);
    return NextResponse.json(
      { message: 'Failed to send notification' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    await sendPaymentReminders();
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
