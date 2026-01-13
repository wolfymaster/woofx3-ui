import { useState } from 'react';
import {
  Plus,
  Search,
  MoreHorizontal,
  Users,
  UserPlus,
  Settings,
  Shield,
  Crown,
  Mail,
  Trash2,
  Edit3,
  Copy,
  ExternalLink,
  Building2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { cn } from '@/lib/utils';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  status: 'active' | 'pending' | 'inactive';
  joinedAt: string;
}

interface Account {
  id: string;
  name: string;
  slug: string;
  avatar?: string;
  memberCount: number;
  createdAt: string;
}

const mockMembers: TeamMember[] = [
  { id: '1', name: 'Alex Chen', email: 'alex@example.com', role: 'owner', status: 'active', joinedAt: '2024-01-01' },
  { id: '2', name: 'Sarah Kim', email: 'sarah@example.com', role: 'admin', status: 'active', joinedAt: '2024-01-05' },
  { id: '3', name: 'Jordan Lee', email: 'jordan@example.com', role: 'member', status: 'active', joinedAt: '2024-01-10' },
  { id: '4', name: 'Taylor Swift', email: 'taylor@example.com', role: 'member', status: 'pending', joinedAt: '2024-01-12' },
  { id: '5', name: 'Chris Park', email: 'chris@example.com', role: 'viewer', status: 'active', joinedAt: '2024-01-08' },
];

const mockAccounts: Account[] = [
  { id: '1', name: 'Main Channel', slug: 'main-channel', memberCount: 4, createdAt: '2024-01-01' },
  { id: '2', name: 'Gaming Channel', slug: 'gaming-channel', memberCount: 2, createdAt: '2024-01-05' },
  { id: '3', name: 'IRL Streams', slug: 'irl-streams', memberCount: 3, createdAt: '2024-01-10' },
];

const roleColors: Record<string, string> = {
  owner: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  admin: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  member: 'bg-green-500/10 text-green-600 dark:text-green-400',
  viewer: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
};

const roleIcons: Record<string, React.ReactNode> = {
  owner: <Crown className="h-3 w-3 mr-1" />,
  admin: <Shield className="h-3 w-3 mr-1" />,
  member: <Users className="h-3 w-3 mr-1" />,
  viewer: <Users className="h-3 w-3 mr-1" />,
};

export default function Team() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('member');
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');

  const filteredMembers = mockMembers.filter(m =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleInvite = () => {
    console.log('Invite:', { email: inviteEmail, role: inviteRole });
    setIsInviting(false);
    setInviteEmail('');
    setInviteRole('member');
  };

  const handleCreateAccount = () => {
    console.log('Create account:', newAccountName);
    setIsCreatingAccount(false);
    setNewAccountName('');
  };

  return (
    <div className="p-6 lg:p-8 max-w-[1200px] mx-auto">
      <PageHeader
        title="Team"
        description="Manage your team members and accounts."
      />

      <Tabs defaultValue="members" className="space-y-6">
        <TabsList>
          <TabsTrigger value="members" data-testid="tab-members">
            <Users className="h-4 w-4 mr-2" />
            Members
            <Badge variant="secondary" className="ml-2">{mockMembers.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="accounts" data-testid="tab-accounts">
            <Building2 className="h-4 w-4 mr-2" />
            Accounts
            <Badge variant="secondary" className="ml-2">{mockAccounts.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle>Team Members</CardTitle>
                  <CardDescription>Invite and manage people in your team.</CardDescription>
                </div>
                <Dialog open={isInviting} onOpenChange={setIsInviting}>
                  <DialogTrigger asChild>
                    <Button data-testid="button-invite-member">
                      <UserPlus className="h-4 w-4 mr-2" />
                      Invite Member
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Invite Team Member</DialogTitle>
                      <DialogDescription>
                        Send an invitation to join your team.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="invite-email">Email Address</Label>
                        <Input
                          id="invite-email"
                          type="email"
                          placeholder="colleague@example.com"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          data-testid="input-invite-email"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Role</Label>
                        <Select value={inviteRole} onValueChange={setInviteRole}>
                          <SelectTrigger data-testid="select-invite-role">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="member">Member</SelectItem>
                            <SelectItem value="viewer">Viewer</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {inviteRole === 'admin' && 'Can manage team settings and members.'}
                          {inviteRole === 'member' && 'Can create and edit workflows and assets.'}
                          {inviteRole === 'viewer' && 'Can view but not modify content.'}
                        </p>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsInviting(false)}>Cancel</Button>
                      <Button onClick={handleInvite} disabled={!inviteEmail} data-testid="button-send-invite">
                        <Mail className="h-4 w-4 mr-2" />
                        Send Invite
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <div className="relative max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search members..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                    data-testid="input-search-members"
                  />
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMembers.map(member => (
                    <TableRow key={member.id} className="hover-elevate" data-testid={`row-member-${member.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarImage src={member.avatar} />
                            <AvatarFallback className="text-xs">
                              {member.name.split(' ').map(n => n[0]).join('')}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{member.name}</p>
                            <p className="text-sm text-muted-foreground">{member.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('capitalize', roleColors[member.role])}>
                          {roleIcons[member.role]}
                          {member.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={member.status === 'active' ? 'secondary' : 'outline'} className="capitalize">
                          {member.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(member.joinedAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem>
                              <Edit3 className="h-4 w-4 mr-2" />
                              Edit Role
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <Mail className="h-4 w-4 mr-2" />
                              Resend Invite
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive">
                              <Trash2 className="h-4 w-4 mr-2" />
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accounts">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold">Accounts</h2>
              <p className="text-muted-foreground">Manage streaming accounts in your team.</p>
            </div>
            <Dialog open={isCreatingAccount} onOpenChange={setIsCreatingAccount}>
              <DialogTrigger asChild>
                <Button data-testid="button-new-account">
                  <Plus className="h-4 w-4 mr-2" />
                  New Account
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Account</DialogTitle>
                  <DialogDescription>
                    Add a new streaming account to your team.
                  </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                  <Label htmlFor="account-name">Account Name</Label>
                  <Input
                    id="account-name"
                    placeholder="e.g., Gaming Channel"
                    value={newAccountName}
                    onChange={(e) => setNewAccountName(e.target.value)}
                    className="mt-2"
                    data-testid="input-account-name"
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreatingAccount(false)}>Cancel</Button>
                  <Button onClick={handleCreateAccount} disabled={!newAccountName} data-testid="button-create-account">
                    Create Account
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mockAccounts.map(account => (
              <Card key={account.id} className="hover-elevate" data-testid={`card-account-${account.id}`}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={account.avatar} />
                        <AvatarFallback className="bg-primary/10 text-primary">
                          {account.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h3 className="font-semibold">{account.name}</h3>
                        <p className="text-sm text-muted-foreground">/{account.slug}</p>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>
                          <Settings className="h-4 w-4 mr-2" />
                          Settings
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <Users className="h-4 w-4 mr-2" />
                          Manage Members
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Open Dashboard
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive">
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="h-4 w-4" />
                      {account.memberCount} members
                    </span>
                    <span>Created {new Date(account.createdAt).toLocaleDateString()}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
