<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('email')->unique();
            $table->string('password');
            $table->string('avatar_url')->nullable();
            $table->timestamps();
        });

        Schema::create('groups', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->foreignId('owner_id')->constrained('users')->cascadeOnDelete();
            $table->string('currency', 3)->default('VND');
            $table->timestamps();
        });

        Schema::create('group_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('group_id')->constrained('groups')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('role')->default('member');
            $table->decimal('total_paid', 14, 2)->default(0);
            $table->timestamps();
        });

        Schema::create('expenses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('group_id')->constrained('groups')->cascadeOnDelete();
            $table->foreignId('payer_id')->constrained('users')->cascadeOnDelete();
            $table->string('title');
            $table->decimal('amount', 14, 2);
            $table->string('category');
            $table->timestamp('spent_at');
            $table->timestamps();
        });

        Schema::create('expense_splits', function (Blueprint $table) {
            $table->id();
            $table->foreignId('expense_id')->constrained('expenses')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->decimal('share_amount', 14, 2);
            $table->boolean('is_settled')->default(false);
            $table->timestamps();
        });

        Schema::create('settlements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('group_id')->constrained('groups')->cascadeOnDelete();
            $table->foreignId('payer_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('receiver_id')->constrained('users')->cascadeOnDelete();
            $table->decimal('amount', 14, 2);
            $table->string('payment_method');
            $table->string('status')->default('completed');
            $table->timestamp('settled_at');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('settlements');
        Schema::dropIfExists('expense_splits');
        Schema::dropIfExists('expenses');
        Schema::dropIfExists('group_members');
        Schema::dropIfExists('groups');
        Schema::dropIfExists('users');
    }
};
