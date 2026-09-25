import { useState } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { TEXT_SIZES, readTextSize, saveTextSize, type TextSize } from '@/lib/textSize';
import { Link } from 'react-router-dom';
import { CircleUserRound, Settings, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';

export function ProfileMenu() {
  const { preference, setPreference } = useTheme();
  const [textSize, setTextSize] = useState<TextSize>(readTextSize);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" aria-label="Profile menu" className="min-h-11 min-w-11 px-2 lg:px-3 [&_svg]:size-5">
          <CircleUserRound />
          <span className="hidden lg:inline">Profile</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild className="min-h-11">
          <Link to="/settings"><Settings />Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="min-h-11">
          <Link to="/review"><ListChecks />Capture review</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={preference} onValueChange={value => {
          if (value === 'system' || value === 'light' || value === 'dark') setPreference(value);
        }}>
          {(['system', 'light', 'dark'] as const).map(value => (
            <DropdownMenuRadioItem key={value} value={value} className="min-h-11">
              {value === 'system' ? 'Follow system' : value === 'light' ? 'Light' : 'Dark'}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Text size</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={textSize} onValueChange={value => {
          const size = TEXT_SIZES.find(s => s.value === value)?.value;
          if (size) { saveTextSize(size); setTextSize(size); }
        }}>
          {TEXT_SIZES.map(size => (
            <DropdownMenuRadioItem key={size.value} value={size.value} className="min-h-11" onSelect={event => event.preventDefault()}>
              <span style={{ fontSize: `${size.percent}%` }}>{size.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
