<?php

namespace App\Services;

use App\Models\Group;
use App\Models\GroupMember;
use Illuminate\Support\Facades\DB;

class GroupService
{
    public function createGroup(array $data, int $ownerId): Group
    {
        return DB::transaction(function () use ($data, $ownerId) {
            $group = Group::create([
                'name' => $data['name'],
                'owner_id' => $ownerId,
                'currency' => $data['currency'],
            ]);

            GroupMember::create([
                'group_id' => $group->id,
                'user_id' => $ownerId,
                'role' => 'owner',
                'total_paid' => 0,
            ]);

            foreach ($data['member_ids'] ?? [] as $memberId) {
                if ($memberId !== $ownerId) {
                    $this->addMemberToGroup($group->id, $memberId, 'member');
                }
            }

            return $group;
        });
    }

    public function addMemberToGroup(int $groupId, int $userId, string $role = 'member'): GroupMember
    {
        return GroupMember::create([
            'group_id' => $groupId,
            'user_id' => $userId,
            'role' => $role,
            'total_paid' => 0,
        ]);
    }
}
