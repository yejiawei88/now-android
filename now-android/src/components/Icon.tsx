import React from 'react';
import {
    Plus, PlusCircle, SmilePlus, ArrowLeft, FileText, Sparkles, Zap, Check, CheckCircle,
    ListChecks, ChevronLeft, ChevronRight, X, Copy, Trash2, Eraser, Download,
    GripVertical, Edit2, AlertCircle, ChevronDown, Heart, FileUp, Folder,
    FolderCog, FolderOpen, MessageSquare, Info, Key, Keyboard, File,
    Tag, Globe, Menu, Loader2, MinusCircle, Clock, Search, TrendingUp, Upload,
    BadgeCheck, TriangleAlert, LucideProps, Bot, ArrowUpDown, Eye, EyeOff,
    Volume2, Volume1, Wand2, Pin, Minus, Square, PlusSquare, Settings, Layers,
    MonitorSmartphone, RefreshCw, ShieldCheck, Laptop, SendHorizontal, CircleStop,
    AlarmClock, Replace, Repeat, Hexagon, Play, Pause, ChevronsUpDown, LayoutGrid,
    Languages, Code2, PencilLine, WifiOff, ArrowLeftRight
} from 'lucide-react';

const FolderFilledIcon: React.FC<Omit<LucideProps, 'ref'>> = ({ className, size = 24, ...props }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={className}
        fill="currentColor"
        {...props}
    >
        <path d="M10 4H4C2.9 4 2 4.9 2 6v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
);

const QuoteFilledIcon: React.FC<Omit<LucideProps, 'ref'>> = ({ className, size = 24, ...props }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={className}
        fill="currentColor"
        {...props}
    >
        <g transform="translate(24 24) scale(-1 -1)">
            <path d="M6 17h4l2-4V7H6v6h3l-3 4zm8 0h4l2-4V7h-6v6h3l-3 4z" />
        </g>
    </svg>
);

// Specialized icon mapping for Material Symbols to Lucide
const iconMap: Record<string, React.ComponentType<Omit<LucideProps, 'ref'>>> = {
    'add': Plus,
    'hexagon': Hexagon,
    'add_circle': PlusCircle,
    'add_reaction': SmilePlus,
    'arrow_back': ArrowLeft,
    'article': FileText,
    'auto_awesome': Sparkles,
    'bolt': Zap,
    'check': Check,
    'check_circle': CheckCircle,
    'checklist': ListChecks,
    'chevron_left': ChevronLeft,
    'chevron_right': ChevronRight,
    'close': X,
    'content_copy': Copy,
    'delete': Trash2,
    'delete_forever': Trash2,
    'delete_sweep': Eraser,
    'download': Download,
    'drag_indicator': GripVertical,
    'edit': Edit2,
    'error': AlertCircle,
    'expand_more': ChevronDown,
    'favorite': Heart,
    'file_open': FileUp,
    'folder': Folder,
    'folder_filled': FolderFilledIcon,
    'folder_managed': FolderCog,
    'folder_open': FolderOpen,
    'format_quote': QuoteFilledIcon,
    'forum': MessageSquare,
    'find_replace': Repeat,
    'import_export': ArrowUpDown,
    'info': Info,
    'key': Key,
    'keyboard': Keyboard,
    'keyboard_arrow_down': ChevronDown,
    'label': Tag,
    'language': Globe,
    'menu': Menu,
    'progress_activity': Loader2,
    'remove_circle': MinusCircle,
    'schedule': Clock,
    'search': Search,
    'trending_up': TrendingUp,
    'upload': Upload,
    'verified': BadgeCheck,
    'warning': TriangleAlert,
    'smart_toy': Bot,
    'chat_bubble_outline': MessageSquare,
    'chat_bubble': MessageSquare,
    'translate': Languages,
    'code': Code2,
    'edit_note': PencilLine,
    'visible': Eye,
    'visibility': Eye,
    'visibility_off': EyeOff,
    'volume_up': Volume2,
    'volume_down': Volume1,
    'magic_button': Wand2,
    'settings': Settings,
    'push_pin': Pin,
    'remove': Minus,
    'filter_none': Layers,
    'crop_square': Square,
    'library_add': PlusSquare,
    'filter_1': Square,
    'devices': MonitorSmartphone,
    'update': RefreshCw,
    'verified_user': ShieldCheck,
    'swap_vert': ArrowUpDown,
    'laptop_windows': Laptop,
    'send': SendHorizontal,
    'stop_circle': CircleStop,
    'alarm': AlarmClock,
    'description': File,
    'file': File,
    'play': Play,
    'pause': Pause,
    'apps': LayoutGrid,
    'unfold_more': ChevronsUpDown,
    'wifi_off': WifiOff,
    'sync_alt': ArrowLeftRight,
};

interface IconProps extends Omit<LucideProps, 'ref'> {
    name: string;
}

const Icon: React.FC<IconProps> = ({ name, className, size, ...props }) => {
    const LucideIcon = iconMap[name] || AlertCircle;
    return <LucideIcon className={className} size={size} {...props} />;
};

export default Icon;
