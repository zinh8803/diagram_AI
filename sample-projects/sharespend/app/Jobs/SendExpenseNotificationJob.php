<?php

namespace App\Jobs;

use App\Models\Expense;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class SendExpenseNotificationJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    protected Expense $expense;

    public function __construct(Expense $expense)
    {
        $this->expense = $expense;
    }

    public function handle(): void
    {
        // Gửi email/push notification cho các thành viên trong nhóm
    }
}
